// Vues filtrées de l'état d'une partie. C'est ici que s'applique la séparation stricte
// public / personnel / déverrouillable / vérité interne : rien n'est envoyé au navigateur
// d'un joueur qui ne lui soit pas destiné.
import type { Database } from '../db.ts';
import { canSee, presence } from '../realtime.ts';
import { loadVersion, type VersionContent } from './scenarios.ts';
import { getGame, itemAccess, launchConditions, type GameRow } from './games.ts';

function publicCharacter(c: VersionContent['characters'][number]) {
  return { ref: c.ref, name: c.name, role: c.role, ...pickPublic(c.public) };
}
function pickPublic(p: any) {
  return { age: p.age, portrait: p.portrait, presentation: p.presentation, relations: p.relations ?? [], alibi: p.alibi, declaredMovements: p.declaredMovements ?? [] };
}

function itemView(it: VersionContent['items'][number], d?: { discovered_at: string; first_player_id: string | null; via: string }) {
  return {
    ref: it.ref, kind: it.kind, type: it.type, title: it.title, locationRef: it.locationRef, confidentiality: it.confidentiality,
    content: it.content, relations: it.relations,
    discoveredAt: d?.discovered_at ?? null, discoveredBy: d?.first_player_id ?? null, via: d?.via ?? null,
  };
}

function timelineVisible(t: VersionContent['timeline'][number], g: GameRow, found: Set<string>, opened: Set<string>, revealed: boolean) {
  const v = t.visibility ?? { type: 'public' };
  if (v.type === 'public') return true;
  if (v.type === 'stage') return g.current_stage >= v.stage;
  if (v.type === 'item') return found.has(v.ref);
  if (v.type === 'envelope') return opened.has(v.ref);
  if (v.type === 'truth') return revealed;
  return false;
}

async function loadCommon(db: Database, gameId: string) {
  const g = await getGame(db.q, gameId);
  const content = await loadVersion(db.q, g.scenario_version_id);
  const [players, discoveries, envelopes, visits, shares, items, links, notes, accusation, votes] = await Promise.all([
    db.q('select id, nickname, character_ref, ready, joined_at, last_seen_at from players where game_id = $1 order by joined_at', [gameId]),
    db.q('select item_ref, first_player_id, via, discovered_at from discoveries where game_id = $1 order by discovered_at', [gameId]),
    db.q('select envelope_ref, opened_at from game_envelopes where game_id = $1', [gameId]),
    db.q('select location_ref, first_player_id, visited_at from location_visits where game_id = $1', [gameId]),
    db.q('select id, player_id, character_ref, info_key, content, shared_at from shares where game_id = $1 order by shared_at', [gameId]),
    db.q('select * from board_items where game_id = $1 order by created_at', [gameId]),
    db.q('select * from board_links where game_id = $1 order by created_at', [gameId]),
    db.one('select body, version, updated_by, updated_at from game_notes where game_id = $1', [gameId]),
    db.one('select * from accusations where game_id = $1', [gameId]),
    db.q('select player_id, suspect_ref, approved_version, voted_at from accusation_votes where game_id = $1', [gameId]),
  ]);
  return { g, content, players, discoveries, envelopes, visits, shares, items, links, notes, accusation, votes };
}

function solutionView(content: VersionContent, accusation: any) {
  const s = content.solution;
  const culprit = content.characters.find((c) => c.ref === s.culprit);
  return {
    culprit: s.culprit,
    culpritName: culprit?.name,
    motive: s.motive,
    motiveText: s.motiveText,
    conclusion: s.conclusion,
    contradictions: s.contradictions,
    keyItems: s.keyItems,
    itemRoles: s.itemRoles,
    truthTimeline: content.timeline.map((t) => ({ ref: t.ref, at: t.at, title: t.title, body: t.body, truth: t.visibility?.type === 'truth', location: t.location, characters: t.characters })),
    lies: content.characters.map((c) => ({ ref: c.ref, name: c.name, lies: c.truth?.lies ?? [] })),
    result: accusation?.result ?? null,
  };
}

export async function playerState(db: Database, gameId: string, playerId: string) {
  const s = await loadCommon(db, gameId);
  const { g, content } = s;
  const me = s.players.find((p) => p.id === playerId)!;
  db.q('update players set last_seen_at = now() where id = $1', [playerId]).catch(() => {});
  const found = new Set(s.discoveries.map((d) => d.item_ref));
  const opened = new Set(s.envelopes.map((e) => e.envelope_ref));
  const revealed = !!g.solution_revealed_at;
  const online = presence(gameId);
  const myChar = content.characters.find((c) => c.ref === me.character_ref);
  const events = await db.q(
    `select id::text, type, audience, actor, payload, created_at from game_events where game_id = $1 and (audience = 'all' or audience = $2) order by game_events.id desc limit 300`,
    [gameId, `player:${playerId}`],
  );
  const lastEventId = (await db.one('select coalesce(max(id), 0)::text as id from game_events where game_id = $1', [gameId]))!.id;

  return {
    role: 'player',
    serverTime: new Date().toISOString(),
    lastEventId,
    game: {
      id: g.id, code: g.code, status: g.status, stage: g.current_stage, createdAt: g.created_at, startedAt: g.started_at,
      revealed, maxPlayers: g.max_players,
      settings: {
        accusationMode: g.settings.accusationMode, allowSharing: g.settings.allowSharing, physicalCards: g.settings.physicalCards,
        accusationStage: g.settings.accusationStage, designatedPlayerId: g.settings.designatedPlayerId ?? s.players[0]?.id ?? null, assignment: g.settings.assignment,
      },
    },
    scenario: {
      slug: content.slug, caseNumber: content.caseNumber, version: content.version, title: content.meta.title, synopsis: content.meta.synopsis,
      objective: content.meta.objective, difficulty: content.meta.difficulty, durationMinutes: content.meta.durationMinutes,
      intro: { tagline: content.meta.intro?.tagline, victim: content.meta.intro?.victim, motives: content.meta.intro?.accusation?.motives ?? [] },
      stages: content.stages.map((st) => (st.idx <= g.current_stage ? { idx: st.idx, title: st.title, description: st.description } : { idx: st.idx, title: null, description: null })),
    },
    me: { id: me.id, nickname: me.nickname, characterRef: me.character_ref, ready: me.ready },
    myCharacter: myChar
      ? {
          ...publicCharacter(myChar),
          private: myChar.private,
          documents: content.items.filter((i) => i.ownerCharacter === myChar.ref).map((i) => itemView(i)),
          shared: s.shares.filter((x) => x.player_id === me.id).map((x) => x.info_key),
        }
      : null,
    players: s.players.map((p) => ({ id: p.id, nickname: p.nickname, characterRef: p.character_ref, ready: p.ready, online: online.has(p.id) })),
    characters: content.characters.map(publicCharacter),
    locations: content.locations.map((l) => {
      const locked = l.stage > g.current_stage;
      const here = content.items.filter((i) => i.locationRef === l.ref && i.confidentiality !== 'personnel');
      return {
        ref: l.ref, name: l.name, stage: l.stage, locked,
        description: l.public.description, hours: l.public.hours, characters: l.public.characters ?? [],
        visited: s.visits.some((v) => v.location_ref === l.ref),
        items: here.filter((i) => found.has(i.ref)).map((i) => i.ref),
        // Éléments non découverts : état et raison seulement, jamais le contenu.
        pending: locked ? [] : here.filter((i) => !found.has(i.ref)).map((i) => {
          const a = itemAccess(content, g, found, opened, i, 'search');
          return { teaser: i.teaser, kind: i.kind, searchable: a.ok, reason: a.ok ? 'Peut être découvert en fouillant ce lieu.' : a.reason };
        }),
      };
    }),
    items: s.discoveries.map((d) => itemView(content.items.find((i) => i.ref === d.item_ref)!, d as any)).filter((i) => i.ref),
    envelopes: content.envelopes.map((e) => ({
      ref: e.ref, title: e.title, stage: e.stage, teaser: e.teaser, opened: opened.has(e.ref),
      openedAt: s.envelopes.find((x) => x.envelope_ref === e.ref)?.opened_at ?? null,
      content: opened.has(e.ref) ? e.content : null,
      unlocks: opened.has(e.ref) ? e.unlocks : [],
    })),
    timeline: content.timeline.filter((t) => timelineVisible(t, g, found, opened, revealed)).map((t) => ({ ref: t.ref, at: t.at, title: t.title, body: t.body, characters: t.characters, location: t.location, truth: t.visibility?.type === 'truth' })),
    journal: events.filter((e) => canSee(e as any, playerId)).map((e) => ({ id: e.id, type: e.type, payload: e.payload, actor: e.actor, at: e.created_at })),
    shares: s.shares.map((x) => ({ id: x.id, playerId: x.player_id, characterRef: x.character_ref, key: x.info_key, content: x.content, at: x.shared_at })),
    board: { items: s.items, links: s.links },
    notes: s.notes,
    accusation: { ...s.accusation, result: revealed ? s.accusation?.result : undefined, votes: s.votes },
    solution: revealed ? solutionView(content, s.accusation) : null,
  };
}

export async function organizerState(db: Database, gameId: string) {
  const s = await loadCommon(db, gameId);
  const { g, content } = s;
  const found = new Set(s.discoveries.map((d) => d.item_ref));
  const opened = new Set(s.envelopes.map((e) => e.envelope_ref));
  const online = presence(gameId);
  const events = await db.q('select id::text, type, audience, actor, payload, created_at from game_events where game_id = $1 order by game_events.id desc limit 500', [gameId]);
  const lastEventId = (await db.one('select coalesce(max(id), 0)::text as id from game_events where game_id = $1', [gameId]))!.id;
  const scans = await db.q('select kind, key, outcome, player_id, created_at from scans where game_id = $1 order by id desc limit 100', [gameId]);
  return {
    role: 'organizer',
    serverTime: new Date().toISOString(),
    lastEventId,
    game: { ...g, invite_token: g.invite_token, revealed: !!g.solution_revealed_at },
    launch: g.status === 'lobby' ? await launchConditions(db.q, g, content) : null,
    scenario: { slug: content.slug, caseNumber: content.caseNumber, version: content.version, title: content.meta.title, synopsis: content.meta.synopsis, objective: content.meta.objective, minPlayers: content.meta.minPlayers, stages: content.stages, motives: content.meta.intro?.accusation?.motives ?? [] },
    players: s.players.map((p) => ({
      ...p, online: online.has(p.id),
      discoveries: s.discoveries.filter((d) => d.first_player_id === p.id).length,
      character: content.characters.find((c) => c.ref === p.character_ref)?.name ?? null,
    })),
    characters: content.characters,
    locations: content.locations,
    items: content.items.map((i) => {
      const d = s.discoveries.find((x) => x.item_ref === i.ref);
      return { ...i, discovered: !!d, discoveredAt: d?.discovered_at ?? null, discoveredBy: d?.first_player_id ?? null, access: d ? null : itemAccess(content, g, found, opened, i, 'search') };
    }),
    envelopes: content.envelopes.map((e) => ({ ...e, opened: opened.has(e.ref) })),
    events: content.events,
    journal: events.map((e) => ({ id: e.id, type: e.type, payload: e.payload, actor: e.actor, audience: e.audience, at: e.created_at })),
    scans,
    shares: s.shares,
    board: { items: s.items, links: s.links },
    notes: s.notes,
    accusation: { ...s.accusation, votes: s.votes },
    solution: solutionView(content, s.accusation),
  };
}

/** Export des données de la partie (sans aucun jeton ni empreinte). */
export async function exportGame(db: Database, gameId: string) {
  const s = await organizerState(db, gameId);
  const { invite_token, ...game } = s.game as any;
  return {
    exportedAt: new Date().toISOString(),
    game,
    scenario: { slug: s.scenario.slug, caseNumber: s.scenario.caseNumber, version: s.scenario.version, title: s.scenario.title },
    players: s.players.map((p: any) => ({ id: p.id, nickname: p.nickname, character: p.character, joinedAt: p.joined_at, discoveries: p.discoveries })),
    discoveries: s.items.filter((i: any) => i.discovered).map((i: any) => ({ ref: i.ref, title: i.title, at: i.discoveredAt, by: i.discoveredBy })),
    envelopes: s.envelopes.filter((e: any) => e.opened).map((e: any) => e.ref),
    journal: s.journal,
    shares: s.shares,
    board: s.board,
    notes: s.notes,
    accusation: s.accusation,
  };
}
