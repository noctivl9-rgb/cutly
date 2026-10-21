// Moteur de partie : création, joueurs, progression, découvertes, enveloppes, partage.
import { randomBytes, randomInt } from 'node:crypto';
import type { Database, Query } from '../db.ts';
import { isUniqueViolation } from '../db.ts';
import { HttpError } from '../http.ts';
import { hashRecovery, hashToken, newRecoveryCode, newToken } from '../auth.ts';
import { logEvent, publish, type GameEvent } from '../realtime.ts';
import { audit, loadVersion, type VersionContent } from './scenarios.ts';

export interface GameSettings {
  assignment: 'libre' | 'auto';
  uniqueCharacters: boolean;
  progression: 'organisateur' | 'auto';
  accusationMode: 'vote' | 'collectif' | 'designe';
  autoReveal: boolean;
  allowSharing: boolean;
  lateJoin: boolean;
  physicalCards: boolean;
  launch: 'manuel' | 'auto';
  accusationStage: number;
  designatedPlayerId?: string | null;
}

export interface GameRow {
  id: string;
  code: string;
  invite_token: string;
  scenario_version_id: string;
  status: 'lobby' | 'running' | 'paused' | 'ended';
  settings: GameSettings;
  max_players: number;
  current_stage: number;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  solution_revealed_at: string | null;
}

const DEFAULTS: GameSettings = {
  assignment: 'libre', uniqueCharacters: true, progression: 'auto', accusationMode: 'collectif', autoReveal: false,
  allowSharing: true, lateJoin: true, physicalCards: true, launch: 'manuel', accusationStage: 3, designatedPlayerId: null,
};

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

export function normalizeSettings(input: any, maxStage: number): GameSettings {
  const s = input ?? {};
  return {
    assignment: pick(s.assignment, ['libre', 'auto'] as const, DEFAULTS.assignment),
    uniqueCharacters: s.uniqueCharacters !== false,
    progression: pick(s.progression, ['organisateur', 'auto'] as const, DEFAULTS.progression),
    accusationMode: pick(s.accusationMode, ['vote', 'collectif', 'designe'] as const, DEFAULTS.accusationMode),
    autoReveal: s.autoReveal === true,
    allowSharing: s.allowSharing !== false,
    lateJoin: s.lateJoin !== false,
    physicalCards: s.physicalCards !== false,
    launch: pick(s.launch, ['manuel', 'auto'] as const, DEFAULTS.launch),
    accusationStage: Math.min(Math.max(1, Number(s.accusationStage) || maxStage), maxStage),
    designatedPlayerId: null,
  };
}

export const codeFormat = /^DX-\d{4,6}$/;
export const normalizeCode = (code: unknown) => {
  const raw = String(code ?? '').toUpperCase().replace(/\s/g, '');
  const digits = raw.replace(/^DX-?/, '');
  return /^\d{4,6}$/.test(digits) ? `DX-${digits}` : raw;
};

// ─── Lecture ─────────────────────────────────────────────────────

export async function getGame(q: Query, gameId: string, lock = false): Promise<GameRow> {
  if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new HttpError(404, 'Partie introuvable');
  const [g] = await q<GameRow>(`select * from games where id = $1 ${lock ? 'for update' : ''}`, [gameId]);
  if (!g) throw new HttpError(404, 'Partie introuvable');
  return g;
}

export async function getGameByCode(q: Query, code: string): Promise<GameRow> {
  const [g] = await q<GameRow>('select * from games where code = $1', [normalizeCode(code)]);
  if (!g) throw new HttpError(404, 'Aucune partie ne correspond à ce code.');
  return g;
}

async function discoveredSet(q: Query, gameId: string) {
  return new Set((await q<{ item_ref: string }>('select item_ref from discoveries where game_id = $1', [gameId])).map((r) => r.item_ref));
}
async function openedSet(q: Query, gameId: string) {
  return new Set((await q<{ envelope_ref: string }>('select envelope_ref from game_envelopes where game_id = $1', [gameId])).map((r) => r.envelope_ref));
}

function assertPlayable(g: GameRow) {
  if (g.status === 'paused') throw new HttpError(423, "La partie est en pause. L'organisateur doit la relancer.");
  if (g.status === 'ended') throw new HttpError(409, 'Cette partie est terminée.');
  if (g.status === 'lobby') throw new HttpError(409, "La partie n'a pas encore commencé.");
}

// ─── Création ────────────────────────────────────────────────────

export async function createGame(db: Database, input: any, adminId: string | null) {
  const slug = String(input?.scenario ?? 'grand-hotel');
  const v = await db.one(
    `select v.id from scenario_versions v join scenarios s on s.id = v.scenario_id
     where s.slug = $1 and v.status = 'published' order by v.version desc limit 1`,
    [slug],
  );
  if (!v) throw new HttpError(404, 'Aucune version publiée de cette enquête.');
  const content = await loadVersion(db.q, v.id);
  const settings = normalizeSettings(input?.settings, Math.max(...content.stages.map((s) => s.idx)));
  const maxPlayers = Math.min(Math.max(Number(input?.maxPlayers) || content.meta.maxPlayers, 1), settings.uniqueCharacters ? content.characters.length : 30);
  const organizerToken = newToken('org');
  const events: GameEvent[] = [];
  const game = await db.tx(async (q) => {
    let row: GameRow | undefined;
    for (let attempt = 0; attempt < 12 && !row; attempt++) {
      const digits = attempt < 8 ? 4 : 5;
      const code = `DX-${randomInt(10 ** (digits - 1), 10 ** digits)}`;
      const exists = await q('select 1 from games where code = $1', [code]);
      if (exists.length) continue;
      [row] = await q<GameRow>(
        `insert into games (code, invite_token, scenario_version_id, settings, max_players, created_by_admin)
         values ($1, $2, $3, $4::jsonb, $5, $6) returning *`,
        [code, randomBytes(18).toString('base64url'), v.id, JSON.stringify(settings), maxPlayers, adminId],
      );
    }
    if (!row) throw new HttpError(503, 'Impossible de générer un code de partie. Réessayez.');
    await q('insert into game_organizers (game_id, token_hash) values ($1, $2)', [row.id, hashToken(organizerToken)]);
    await q('insert into game_notes (game_id) values ($1)', [row.id]);
    await q('insert into accusations (game_id) values ($1)', [row.id]);
    events.push(await logEvent(q, row.id, 'game.created', { code: row.code, title: content.meta.title }, { actor: 'organizer' }));
    await audit(q, adminId ? `admin:${adminId}` : 'organizer', 'game.create', row.id, { code: row.code, version: content.version });
    return row;
  });
  publish(events);
  return { game, organizerToken };
}

// ─── Joueurs ─────────────────────────────────────────────────────

export async function lookupGame(db: Database, code: string) {
  const g = await getGameByCode(db.q, code);
  const content = await loadVersion(db.q, g.scenario_version_id);
  const taken = await db.q<{ character_ref: string }>('select character_ref from players where game_id = $1 and character_ref is not null', [g.id]);
  const count = (await db.one<{ n: number }>('select count(*)::int as n from players where game_id = $1', [g.id]))!.n;
  const takenSet = new Set(taken.map((t) => t.character_ref));
  return {
    id: g.id,
    code: g.code,
    status: g.status,
    title: content.meta.title,
    caseNumber: content.caseNumber,
    scenario: content.slug,
    synopsis: content.meta.synopsis,
    maxPlayers: g.max_players,
    playerCount: count,
    joinable: g.status === 'lobby' || ((g.status === 'running' || g.status === 'paused') && g.settings.lateJoin),
    assignment: g.settings.assignment,
    uniqueCharacters: g.settings.uniqueCharacters,
    characters: content.characters.map((c) => ({
      ref: c.ref, name: c.name, role: c.role, portrait: c.public.portrait, presentation: c.public.presentation,
      available: !(g.settings.uniqueCharacters && takenSet.has(c.ref)),
    })),
  };
}

export async function joinGame(db: Database, input: any) {
  const nickname = String(input?.nickname ?? '').trim().replace(/\s+/g, ' ');
  if (nickname.length < 1 || nickname.length > 32) throw new HttpError(400, 'Le pseudonyme doit comporter entre 1 et 32 caractères.');
  const token = newToken('pl');
  const recovery = newRecoveryCode();
  const events: GameEvent[] = [];
  const result = await db.tx(async (q) => {
    const g0 = await getGameByCode(q, input?.code);
    const g = await getGame(q, g0.id, true); // verrou : sérialise les inscriptions d'une même partie
    if (input?.invite && input.invite !== g.invite_token) throw new HttpError(403, "Lien d'invitation invalide.");
    if (g.status === 'ended') throw new HttpError(409, 'Cette partie est terminée.');
    if (g.status !== 'lobby' && !g.settings.lateJoin) throw new HttpError(409, 'La partie a commencé et n’accepte plus de nouveaux joueurs.');
    const content = await loadVersion(q, g.scenario_version_id);
    const players = await q<{ character_ref: string | null; nickname: string }>('select character_ref, nickname from players where game_id = $1', [g.id]);
    if (players.length >= g.max_players) throw new HttpError(409, 'La partie est complète.');
    if (players.some((p) => p.nickname.toLowerCase() === nickname.toLowerCase())) throw new HttpError(409, 'Ce pseudonyme est déjà utilisé dans la partie.');
    const taken = new Set(players.map((p) => p.character_ref).filter(Boolean));
    let characterRef: string | null = null;
    if (g.settings.assignment === 'libre') {
      characterRef = String(input?.characterRef ?? '') || null;
      if (!characterRef) throw new HttpError(400, 'Choisissez un personnage.');
      if (!content.characters.some((c) => c.ref === characterRef)) throw new HttpError(400, 'Personnage inconnu.');
      if (g.settings.uniqueCharacters && taken.has(characterRef)) throw new HttpError(409, 'Ce personnage est déjà attribué à un autre joueur.');
    } else {
      const free = content.characters.filter((c) => !g.settings.uniqueCharacters || !taken.has(c.ref));
      if (!free.length) throw new HttpError(409, 'Plus aucun personnage disponible.');
      characterRef = free[randomInt(free.length)].ref;
    }
    let player;
    try {
      [player] = await q(
        `insert into players (game_id, nickname, character_ref, exclusive, token_hash, recovery_hash)
         values ($1, $2, $3, $4, $5, $6) returning id, nickname, character_ref`,
        [g.id, nickname, characterRef, g.settings.uniqueCharacters, hashToken(token), hashRecovery(g.id, recovery)],
      );
    } catch (err) {
      if (isUniqueViolation(err, 'players_unique_character')) throw new HttpError(409, 'Ce personnage est déjà attribué à un autre joueur.');
      if (isUniqueViolation(err)) throw new HttpError(409, 'Ce pseudonyme est déjà utilisé dans la partie.');
      throw err;
    }
    const ch = content.characters.find((c) => c.ref === characterRef);
    events.push(await logEvent(q, g.id, 'player.joined', { playerId: player.id, nickname, character: ch?.name ?? null, characterRef }, { actor: `player:${player.id}` }));
    return { gameId: g.id, code: g.code, playerId: player.id as string, characterRef };
  });
  publish(events);
  return { ...result, token, recoveryCode: recovery };
}

export async function recoverPlayer(db: Database, input: any) {
  const g = await getGameByCode(db.q, input?.code);
  const token = newToken('pl');
  const [p] = await db.q(
    'update players set token_hash = $3, last_seen_at = now() where game_id = $1 and recovery_hash = $2 returning id, nickname',
    [g.id, hashRecovery(g.id, String(input?.recoveryCode ?? '')), hashToken(token)],
  );
  if (!p) throw new HttpError(401, 'Code personnel incorrect.');
  await audit(db.q, `player:${p.id}`, 'player.recover', g.id, {});
  return { gameId: g.id, code: g.code, playerId: p.id, token };
}

/** Le joueur quitte une partie (salle d'attente uniquement) : libère son personnage. */
export async function leaveGame(db: Database, gameId: string, playerId: string) {
  const events: GameEvent[] = [];
  await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    if (g.status !== 'lobby') throw new HttpError(409, "On ne peut quitter qu'avant le lancement. Demandez à l'organisateur.");
    const [p] = await q('delete from players where id = $1 and game_id = $2 returning nickname', [playerId, gameId]);
    if (p) events.push(await logEvent(q, gameId, 'player.left', { playerId, nickname: p.nickname }));
  });
  publish(events);
}

export async function setReady(db: Database, gameId: string, playerId: string, ready: boolean) {
  const events: GameEvent[] = [];
  await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    await q('update players set ready = $3 where id = $1 and game_id = $2', [playerId, gameId, ready]);
    events.push(await logEvent(q, gameId, 'player.ready', { playerId, ready }));
    if (ready && g.status === 'lobby' && g.settings.launch === 'auto') {
      const content = await loadVersion(q, g.scenario_version_id);
      const ps = await q<{ ready: boolean }>('select ready from players where game_id = $1', [gameId]);
      if (ps.length >= content.meta.minPlayers && ps.every((p) => p.ready)) events.push(...(await startInTx(q, g, 'auto')));
    }
  });
  publish(events);
}

// ─── Contrôle organisateur ───────────────────────────────────────

async function startInTx(q: Query, g: GameRow, actor: string) {
  await q(`update games set status = 'running', started_at = now() where id = $1`, [g.id]);
  return [await logEvent(q, g.id, 'game.started', {}, { actor })];
}

export async function launchConditions(q: Query, g: GameRow, content: VersionContent) {
  const ps = await q<{ character_ref: string | null; ready: boolean }>('select character_ref, ready from players where game_id = $1', [g.id]);
  const problems: string[] = [];
  if (ps.length < content.meta.minPlayers) problems.push(`Au moins ${content.meta.minPlayers} joueurs sont nécessaires (${ps.length} inscrits).`);
  if (ps.some((p) => !p.character_ref)) problems.push('Tous les joueurs doivent avoir un personnage.');
  return { ok: problems.length === 0, problems, players: ps.length, ready: ps.filter((p) => p.ready).length };
}

export async function organizerAction(db: Database, gameId: string, actor: string, action: string, body: any) {
  const events: GameEvent[] = [];
  const result = await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    const content = await loadVersion(q, g.scenario_version_id);
    switch (action) {
      case 'start': {
        if (g.status !== 'lobby') throw new HttpError(409, 'La partie a déjà commencé.');
        const cond = await launchConditions(q, g, content);
        if (!cond.ok && !body?.force) throw new HttpError(409, cond.problems.join(' '), { problems: cond.problems });
        events.push(...(await startInTx(q, g, actor)));
        break;
      }
      case 'pause':
        if (g.status !== 'running') throw new HttpError(409, 'Seule une partie en cours peut être mise en pause.');
        await q(`update games set status = 'paused' where id = $1`, [gameId]);
        events.push(await logEvent(q, gameId, 'game.paused', {}, { actor }));
        break;
      case 'resume':
        if (g.status !== 'paused') throw new HttpError(409, "La partie n'est pas en pause.");
        await q(`update games set status = 'running' where id = $1`, [gameId]);
        events.push(await logEvent(q, gameId, 'game.resumed', {}, { actor }));
        break;
      case 'end':
        if (g.status === 'ended') break;
        await q(`update games set status = 'ended', ended_at = now() where id = $1`, [gameId]);
        events.push(await logEvent(q, gameId, 'game.ended', {}, { actor }));
        break;
      case 'stage': {
        const idx = Number(body?.stage);
        if (!content.stages.some((s) => s.idx === idx)) throw new HttpError(400, 'Étape inconnue.');
        if (idx === g.current_stage) break;
        await q('update games set current_stage = $2 where id = $1', [gameId, idx]);
        const st = content.stages.find((s) => s.idx === idx)!;
        events.push(await logEvent(q, gameId, 'stage.unlocked', { stage: idx, title: st.title, description: st.description }, { actor }));
        break;
      }
      case 'envelope': {
        const env = content.envelopes.find((e) => e.ref === body?.ref);
        if (!env) throw new HttpError(404, 'Enveloppe inconnue.');
        const ins = await q('insert into game_envelopes (game_id, envelope_ref, opened_by) values ($1, $2, $3) on conflict do nothing returning envelope_ref', [gameId, env.ref, actor]);
        if (ins.length) {
          events.push(await logEvent(q, gameId, 'envelope.opened', { ref: env.ref, title: env.title }, { actor }));
          events.push(...(await discover(q, g, content, null, env.unlocks, 'envelope')));
        }
        break;
      }
      case 'event': {
        const ev = content.events.find((e) => e.ref === body?.ref);
        if (!ev) throw new HttpError(404, 'Événement inconnu.');
        events.push(await logEvent(q, gameId, 'story.event', { ref: ev.ref, title: ev.title, body: ev.body }, { actor }));
        events.push(...(await discover(q, g, content, null, ev.unlocks, 'event')));
        break;
      }
      case 'announce': {
        const text = String(body?.text ?? '').trim().slice(0, 500);
        if (!text) throw new HttpError(400, 'Annonce vide.');
        events.push(await logEvent(q, gameId, 'announcement', { text }, { actor }));
        break;
      }
      case 'assign': {
        const ref = body?.characterRef ? String(body.characterRef) : null;
        if (ref && !content.characters.some((c) => c.ref === ref)) throw new HttpError(400, 'Personnage inconnu.');
        try {
          const [p] = await q('update players set character_ref = $3 where id = $2 and game_id = $1 returning id, nickname', [gameId, body?.playerId, ref]);
          if (!p) throw new HttpError(404, 'Joueur introuvable.');
          events.push(await logEvent(q, gameId, 'player.assigned', { playerId: p.id, nickname: p.nickname, characterRef: ref, character: content.characters.find((c) => c.ref === ref)?.name ?? null }, { actor }));
        } catch (err) {
          if (isUniqueViolation(err, 'players_unique_character')) throw new HttpError(409, 'Ce personnage est déjà attribué.');
          throw err;
        }
        break;
      }
      case 'remove-player': {
        const [p] = await q('delete from players where id = $2 and game_id = $1 returning nickname', [gameId, body?.playerId]);
        if (!p) throw new HttpError(404, 'Joueur introuvable.');
        events.push(await logEvent(q, gameId, 'player.left', { playerId: body.playerId, nickname: p.nickname }, { actor }));
        break;
      }
      case 'designate': {
        const [p] = await q('select id, nickname from players where id = $2 and game_id = $1', [gameId, body?.playerId]);
        if (!p) throw new HttpError(404, 'Joueur introuvable.');
        await q(`update games set settings = jsonb_set(settings, '{designatedPlayerId}', to_jsonb($2::text)) where id = $1`, [gameId, p.id]);
        events.push(await logEvent(q, gameId, 'accusation.designated', { playerId: p.id, nickname: p.nickname }, { actor }));
        break;
      }
      case 'reveal': {
        const [a] = await q('select status from accusations where game_id = $1', [gameId]);
        if (a?.status !== 'submitted' && !body?.force) throw new HttpError(409, "Aucune accusation n'a été soumise. Confirmez pour révéler quand même.");
        if (g.solution_revealed_at) break;
        await q('update games set solution_revealed_at = now() where id = $1', [gameId]);
        events.push(await logEvent(q, gameId, 'solution.revealed', {}, { actor }));
        break;
      }
      case 'reset-recovery': {
        const code = newRecoveryCode();
        const [p] = await q('update players set recovery_hash = $3 where id = $2 and game_id = $1 returning id', [gameId, body?.playerId, hashRecovery(gameId, code)]);
        if (!p) throw new HttpError(404, 'Joueur introuvable.');
        await audit(q, actor, 'player.recovery.reset', gameId, { playerId: p.id });
        return { recoveryCode: code };
      }
      default:
        throw new HttpError(400, 'Action inconnue.');
    }
    await audit(q, actor, `game.${action}`, gameId, { ref: body?.ref, stage: body?.stage, playerId: body?.playerId });
    return { ok: true };
  });
  publish(events);
  return result;
}

// ─── Découvertes ─────────────────────────────────────────────────

type Access = { ok: true } | { ok: false; reason: string; code: string };

export function itemAccess(content: VersionContent, g: GameRow, found: Set<string>, opened: Set<string>, item: VersionContent['items'][number], via: string): Access {
  if (item.confidentiality === 'personnel') return { ok: false, code: 'personnel', reason: 'Document personnel.' };
  const modes: string[] = item.discovery?.modes ?? [];
  const viaOk = modes.includes(via) || (via === 'search' && modes.includes('qr') && !g.settings.physicalCards);
  if (!viaOk) {
    if (item.discovery?.envelope && !opened.has(item.discovery.envelope)) return { ok: false, code: 'envelope', reason: "Disponible après l'ouverture d'une enveloppe par l'organisateur." };
    if (modes.includes('qr') && via === 'search') return { ok: false, code: 'qr', reason: 'Cet élément se trouve sur une carte physique à scanner.' };
    if (modes.includes('envelope') && modes.length === 1) return { ok: false, code: 'envelope', reason: "Contenu d'une enveloppe encore scellée." };
    return { ok: false, code: 'mode', reason: "Cet élément ne peut pas être découvert de cette manière." };
  }
  const loc = content.locations.find((l) => l.ref === item.locationRef);
  if (via !== 'envelope' && via !== 'event' && loc && loc.stage > g.current_stage) return { ok: false, code: 'stage', reason: `Le lieu sera accessible à l'étape ${loc.stage}.` };
  if (via !== 'envelope' && via !== 'event' && item.stage > g.current_stage) return { ok: false, code: 'stage', reason: `Disponible à l'étape ${item.stage}.` };
  if (item.discovery?.envelope && !opened.has(item.discovery.envelope)) return { ok: false, code: 'envelope', reason: "Disponible après l'ouverture d'une enveloppe par l'organisateur." };
  const missing = (item.discovery?.requires ?? []).filter((r: string) => !found.has(r));
  if (missing.length) return { ok: false, code: 'requires', reason: 'Un autre indice doit être découvert avant celui-ci.' };
  return { ok: true };
}

/** Enregistre des découvertes (idempotent) et fait avancer la progression automatique. */
async function discover(q: Query, g: GameRow, content: VersionContent, playerId: string | null, refs: string[], via: string) {
  const events: GameEvent[] = [];
  const nickname = playerId ? (await q('select nickname from players where id = $1', [playerId]))[0]?.nickname : null;
  for (const ref of refs) {
    const item = content.items.find((i) => i.ref === ref);
    if (!item) continue;
    const ins = await q(
      'insert into discoveries (game_id, item_ref, first_player_id, via) values ($1, $2, $3, $4) on conflict (game_id, item_ref) do nothing returning discovered_at',
      [g.id, ref, playerId, via],
    );
    if (ins.length) {
      events.push(await logEvent(q, g.id, 'item.discovered', { ref, title: item.title, kind: item.kind, by: nickname, playerId, via, location: item.locationRef }, { actor: playerId ? `player:${playerId}` : 'organizer' }));
    }
  }
  if (events.length) events.push(...(await autoProgress(q, g, content)));
  return events;
}

async function autoProgress(q: Query, g: GameRow, content: VersionContent) {
  const events: GameEvent[] = [];
  if (g.settings.progression !== 'auto') return events;
  const found = await discoveredSet(q, g.id);
  let stage = (await q('select current_stage from games where id = $1', [g.id]))[0].current_stage as number;
  for (;;) {
    const next = content.stages.find((s) => s.idx === stage + 1);
    if (!next || next.unlock?.type !== 'items') break;
    const u = next.unlock;
    const allOk = (u.all ?? []).every((r: string) => found.has(r));
    const amongOk = !u.among || (u.among as string[]).filter((r) => found.has(r)).length >= (u.min ?? u.among.length);
    if (!allOk || !amongOk) break;
    const upd = await q('update games set current_stage = $2 where id = $1 and current_stage = $3 returning id', [g.id, next.idx, stage]);
    if (!upd.length) break;
    stage = next.idx;
    g.current_stage = stage;
    events.push(await logEvent(q, g.id, 'stage.unlocked', { stage: next.idx, title: next.title, description: next.description }, { actor: 'engine' }));
  }
  return events;
}

export async function searchLocation(db: Database, gameId: string, playerId: string, locationRef: string) {
  const events: GameEvent[] = [];
  const result = await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    assertPlayable(g);
    const content = await loadVersion(q, g.scenario_version_id);
    const loc = content.locations.find((l) => l.ref === locationRef);
    if (!loc) throw new HttpError(404, 'Lieu inconnu.');
    if (loc.stage > g.current_stage) throw new HttpError(403, `Ce lieu sera accessible à l'étape ${loc.stage}.`);
    await q('insert into location_visits (game_id, location_ref, first_player_id) values ($1, $2, $3) on conflict do nothing', [gameId, loc.ref, playerId]);
    const found = await discoveredSet(q, gameId);
    const opened = await openedSet(q, gameId);
    const candidates = content.items.filter((i) => i.locationRef === loc.ref && !found.has(i.ref));
    // Les prérequis peuvent être satisfaits dans la même fouille : on itère jusqu'à stabilité.
    const newly: string[] = [];
    let progress = true;
    while (progress) {
      progress = false;
      for (const it of candidates) {
        if (found.has(it.ref)) continue;
        if (itemAccess(content, g, found, opened, it, 'search').ok) {
          found.add(it.ref);
          newly.push(it.ref);
          progress = true;
        }
      }
    }
    events.push(...(await discover(q, g, content, playerId, newly, 'search')));
    return { found: newly };
  });
  publish(events);
  return result;
}

export async function resolveResource(q: Query, kind: string, key: string) {
  const [r] = await q(
    `select r.* from resources r where r.kind = $1 and r.key = $2
     union all
     select r.* from resource_aliases a join resources r on r.id = a.resource_id where a.kind = $1 and a.key = $2
     limit 1`,
    [kind, key],
  );
  return r as { id: string; scenario_id: string; kind: string; key: string; ref: string } | undefined;
}

export async function scan(db: Database, gameId: string, player: { id: string; nickname: string }, kind: string, key: string) {
  const events: GameEvent[] = [];
  const out = await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    // Saisie manuelle de la référence imprimée : recherche dans l'enquête de la partie.
    const res = kind === 'auto'
      ? (await q(
          `select r.* from resources r join scenario_versions v on v.scenario_id = r.scenario_id
           where v.id = $1 and lower(r.key) = lower($2) limit 1`,
          [g.scenario_version_id, key.trim()],
        ))[0] as Awaited<ReturnType<typeof resolveResource>>
      : await resolveResource(q, kind, key);
    const record = (outcome: string) => q('insert into scans (game_id, player_id, kind, key, outcome) values ($1, $2, $3, $4, $5)', [gameId, player.id, kind, key, outcome]);
    if (!res) {
      await record('unknown');
      throw new HttpError(404, 'Ce QR code ne correspond à aucune ressource connue.');
    }
    const content = await loadVersion(q, g.scenario_version_id);
    if (res.scenario_id !== content.scenarioId) {
      await record('wrong-scenario');
      throw new HttpError(409, 'Cette carte appartient à une autre enquête que celle de votre partie.');
    }
    assertPlayable(g);
    if (res.kind === 'lieu') {
      const loc = content.locations.find((l) => l.ref === res.ref);
      if (!loc) throw new HttpError(410, "Ce lieu n'existe pas dans la version de l'enquête utilisée par votre partie.");
      await record('ok');
      if (loc.stage > g.current_stage) return { type: 'lieu', ref: loc.ref, locked: true, reason: `Ce lieu sera accessible à l'étape ${loc.stage}.` };
      await q('insert into location_visits (game_id, location_ref, first_player_id) values ($1, $2, $3) on conflict do nothing', [gameId, loc.ref, player.id]);
      return { type: 'lieu', ref: loc.ref, locked: false };
    }
    if (res.kind === 'enveloppe') {
      await record('ok');
      const opened = await openedSet(q, gameId);
      return { type: 'enveloppe', ref: res.ref, locked: !opened.has(res.ref), reason: opened.has(res.ref) ? null : "Cette enveloppe est scellée. Seul l'organisateur peut l'ouvrir." };
    }
    if (res.kind === 'evenement') {
      await record('ok');
      return { type: 'evenement', ref: res.ref, locked: true, reason: "Cet événement doit être déclenché par l'organisateur." };
    }
    const item = content.items.find((i) => i.ref === res.ref);
    if (!item) throw new HttpError(410, "Cette ressource n'existe pas dans la version de l'enquête utilisée par votre partie.");
    const found = await discoveredSet(q, gameId);
    if (found.has(item.ref)) {
      await record('already');
      return { type: 'item', ref: item.ref, locked: false, already: true };
    }
    const access = itemAccess(content, g, found, await openedSet(q, gameId), item, 'qr');
    await record(access.ok ? 'ok' : `locked:${access.code}`);
    if (!access.ok) return { type: 'item', ref: item.ref, locked: true, reason: access.reason };
    events.push(...(await discover(q, g, content, player.id, [item.ref], 'qr')));
    return { type: 'item', ref: item.ref, locked: false, already: false };
  });
  publish(events);
  return out;
}

// ─── Partage volontaire d'informations ───────────────────────────

export async function shareInfo(db: Database, gameId: string, playerId: string, key: string) {
  const events: GameEvent[] = [];
  await db.tx(async (q) => {
    const g = await getGame(q, gameId, true);
    assertPlayable(g);
    if (!g.settings.allowSharing) throw new HttpError(403, "Le partage d'informations est désactivé pour cette partie.");
    const [p] = await q('select id, nickname, character_ref from players where id = $1', [playerId]);
    const content = await loadVersion(q, g.scenario_version_id);
    const ch = content.characters.find((c) => c.ref === p.character_ref);
    if (!ch) throw new HttpError(409, "Vous n'incarnez aucun personnage.");
    let shared: { label: string; text: string; ref?: string } | undefined;
    const info = (ch.private.shareable ?? []).find((s: any) => s.key === key);
    if (info) shared = { label: info.label, text: info.text };
    const doc = content.items.find((i) => i.ref === key && i.ownerCharacter === ch.ref);
    if (doc) shared = { label: doc.title, text: [doc.content.body, doc.content.transcript].filter(Boolean).join('\n'), ref: doc.ref };
    if (!shared) throw new HttpError(404, 'Information non partageable.');
    const ins = await q(
      'insert into shares (game_id, player_id, character_ref, info_key, content) values ($1, $2, $3, $4, $5::jsonb) on conflict do nothing returning id',
      [gameId, playerId, ch.ref, key, JSON.stringify(shared)],
    );
    if (ins.length) events.push(await logEvent(q, gameId, 'info.shared', { key, label: shared.label, by: p.nickname, character: ch.name }, { actor: `player:${playerId}` }));
    await audit(q, `player:${playerId}`, 'info.share', gameId, { key, character: ch.ref });
  });
  publish(events);
}

export { assertPlayable, discoveredSet, openedSet };
