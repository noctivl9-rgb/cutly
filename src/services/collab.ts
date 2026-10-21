// Collaboration : tableau d'enquête, notes communes et accusation collective.
// Concurrence : chaque objet modifiable porte un numéro de version. Une écriture qui ne
// présente pas la version courante est refusée (409) avec l'état actuel, pour résolution.
import type { Database, Query } from '../db.ts';
import { isUniqueViolation } from '../db.ts';
import { HttpError } from '../http.ts';
import { logEvent, publish, type GameEvent } from '../realtime.ts';
import { loadVersion } from './scenarios.ts';
import { assertPlayable, discoveredSet, getGame, organizerAction, type GameRow } from './games.ts';

const KINDS = ['indice', 'personnage', 'lieu', 'note', 'hypothese'] as const;
const LANES = ['piste', 'confirme', 'ecarte'] as const;
const clampText = (v: unknown, max: number) => String(v ?? '').slice(0, max);
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(-5000, Math.min(5000, Number(v))) : d);

async function withGame<T>(db: Database, gameId: string, fn: (q: Query, g: GameRow, events: GameEvent[]) => Promise<T>) {
  const events: GameEvent[] = [];
  const out = await db.tx(async (q) => {
    const g = await getGame(q, gameId);
    assertPlayable(g);
    return fn(q, g, events);
  });
  publish(events);
  return out;
}

// ─── Tableau ─────────────────────────────────────────────────────

export async function createBoardItem(db: Database, gameId: string, playerId: string, body: any) {
  return withGame(db, gameId, async (q, g, events) => {
    const kind = body?.kind;
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Type de carte inconnu.');
    const content = await loadVersion(q, g.scenario_version_id);
    let ref: string | null = body?.ref ? String(body.ref) : null;
    if (kind === 'indice') {
      if (!ref || !(await discoveredSet(q, gameId)).has(ref)) throw new HttpError(403, 'Seules les preuves découvertes peuvent être placées au tableau.');
    } else if (kind === 'personnage') {
      if (!content.characters.some((c) => c.ref === ref)) throw new HttpError(400, 'Personnage inconnu.');
    } else if (kind === 'lieu') {
      if (!content.locations.some((l) => l.ref === ref)) throw new HttpError(400, 'Lieu inconnu.');
    } else ref = null;
    const text = clampText(body?.text, 600);
    if ((kind === 'note' || kind === 'hypothese') && !text.trim()) throw new HttpError(400, 'Le texte est vide.');
    const lane = LANES.includes(body?.lane) ? body.lane : 'piste';
    const [item] = await q(
      `insert into board_items (game_id, kind, ref, text, x, y, lane, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning *`,
      [gameId, kind, ref, text, num(body?.x, 40), num(body?.y, 40), lane, playerId],
    );
    events.push(await logEvent(q, gameId, 'board.changed', { op: 'create', id: item.id, kind }, { actor: `player:${playerId}` }));
    return item;
  });
}

export async function updateBoardItem(db: Database, gameId: string, playerId: string, itemId: string, body: any) {
  return withGame(db, gameId, async (q, _g, events) => {
    const version = Number(body?.version);
    const [cur] = await q('select * from board_items where id = $1 and game_id = $2', [itemId, gameId]);
    if (!cur) throw new HttpError(404, 'Carte introuvable.');
    const next = {
      text: body?.text !== undefined ? clampText(body.text, 600) : cur.text,
      x: body?.x !== undefined ? num(body.x, cur.x) : cur.x,
      y: body?.y !== undefined ? num(body.y, cur.y) : cur.y,
      lane: body?.lane !== undefined ? (LANES.includes(body.lane) ? body.lane : cur.lane) : cur.lane,
    };
    const [item] = await q(
      `update board_items set text = $4, x = $5, y = $6, lane = $7, version = version + 1, updated_by = $3, updated_at = now()
       where id = $1 and game_id = $2 and version = $8 returning *`,
      [itemId, gameId, playerId, next.text, next.x, next.y, next.lane, version],
    );
    if (!item) throw new HttpError(409, 'Cette carte a été modifiée entre-temps par un autre enquêteur.', { current: cur });
    events.push(await logEvent(q, gameId, 'board.changed', { op: 'update', id: itemId }, { actor: `player:${playerId}` }));
    return item;
  });
}

export async function deleteBoardItem(db: Database, gameId: string, playerId: string, itemId: string) {
  return withGame(db, gameId, async (q, _g, events) => {
    const del = await q('delete from board_items where id = $1 and game_id = $2 returning id', [itemId, gameId]);
    if (!del.length) throw new HttpError(404, 'Carte introuvable.');
    events.push(await logEvent(q, gameId, 'board.changed', { op: 'delete', id: itemId }, { actor: `player:${playerId}` }));
    return { ok: true };
  });
}

export async function createBoardLink(db: Database, gameId: string, playerId: string, body: any) {
  return withGame(db, gameId, async (q, _g, events) => {
    const ends = await q('select id from board_items where game_id = $1 and id = any($2::uuid[])', [gameId, [body?.fromId, body?.toId]]);
    if (ends.length !== 2) throw new HttpError(400, 'Les deux cartes doivent appartenir au tableau de cette partie.');
    try {
      const [link] = await q(
        'insert into board_links (game_id, from_id, to_id, label, created_by) values ($1, $2, $3, $4, $5) returning *',
        [gameId, body.fromId, body.toId, clampText(body?.label, 120), playerId],
      );
      events.push(await logEvent(q, gameId, 'board.changed', { op: 'link', id: link.id }, { actor: `player:${playerId}` }));
      return link;
    } catch (err) {
      if (isUniqueViolation(err)) throw new HttpError(409, 'Ces deux cartes sont déjà reliées.');
      throw err;
    }
  });
}

export async function deleteBoardLink(db: Database, gameId: string, playerId: string, linkId: string) {
  return withGame(db, gameId, async (q, _g, events) => {
    const del = await q('delete from board_links where id = $1 and game_id = $2 returning id', [linkId, gameId]);
    if (!del.length) throw new HttpError(404, 'Lien introuvable.');
    events.push(await logEvent(q, gameId, 'board.changed', { op: 'unlink', id: linkId }, { actor: `player:${playerId}` }));
    return { ok: true };
  });
}

// ─── Notes communes ──────────────────────────────────────────────

export async function saveNotes(db: Database, gameId: string, playerId: string, body: any) {
  return withGame(db, gameId, async (q, _g, events) => {
    const text = clampText(body?.body, 20000);
    const [row] = await q(
      `update game_notes set body = $3, version = version + 1, updated_by = $2, updated_at = now()
       where game_id = $1 and version = $4 returning version, updated_at`,
      [gameId, playerId, text, Number(body?.version)],
    );
    if (!row) {
      const [cur] = await q('select body, version, updated_by from game_notes where game_id = $1', [gameId]);
      throw new HttpError(409, 'Les notes ont été modifiées par un autre enquêteur pendant que vous écriviez.', { current: cur });
    }
    events.push(await logEvent(q, gameId, 'notes.changed', { version: row.version }, { actor: `player:${playerId}` }));
    return row;
  });
}

// ─── Accusation ──────────────────────────────────────────────────

function checkAccusationStage(g: GameRow) {
  if (g.current_stage < g.settings.accusationStage) throw new HttpError(409, `L'accusation s'ouvre à l'étape ${g.settings.accusationStage}.`);
}

export async function saveAccusation(db: Database, gameId: string, playerId: string, body: any) {
  return withGame(db, gameId, async (q, g, events) => {
    checkAccusationStage(g);
    const [cur] = await q('select * from accusations where game_id = $1', [gameId]);
    if (cur.status === 'submitted') throw new HttpError(409, "L'accusation a déjà été soumise.");
    const content = await loadVersion(q, g.scenario_version_id);
    const found = await discoveredSet(q, gameId);
    const suspect = body?.suspectRef ? String(body.suspectRef) : null;
    if (suspect && !content.characters.some((c) => c.ref === suspect)) throw new HttpError(400, 'Suspect inconnu.');
    const items = Array.isArray(body?.itemRefs) ? [...new Set(body.itemRefs.map(String))].filter((r) => found.has(r as string)) : [];
    const [row] = await q(
      `update accusations set suspect_ref = $3, motive = $4, chronology = $5, item_refs = $6::jsonb, contradictions = $7, explanation = $8,
         version = version + 1, updated_by = $2 where game_id = $1 and version = $9 returning *`,
      [gameId, playerId, suspect, clampText(body?.motive, 60), clampText(body?.chronology, 4000), JSON.stringify(items), clampText(body?.contradictions, 4000), clampText(body?.explanation, 6000), Number(body?.version)],
    );
    if (!row) throw new HttpError(409, "L'accusation a été modifiée par un autre enquêteur.", { current: cur });
    events.push(await logEvent(q, gameId, 'accusation.changed', { version: row.version }, { actor: `player:${playerId}` }));
    return row;
  });
}

export async function voteAccusation(db: Database, gameId: string, playerId: string, body: any) {
  return withGame(db, gameId, async (q, g, events) => {
    checkAccusationStage(g);
    const [acc] = await q('select status, version from accusations where game_id = $1', [gameId]);
    if (acc.status === 'submitted') throw new HttpError(409, "L'accusation a déjà été soumise.");
    const content = await loadVersion(q, g.scenario_version_id);
    const suspect = body?.suspectRef ? String(body.suspectRef) : null;
    if (suspect && !content.characters.some((c) => c.ref === suspect)) throw new HttpError(400, 'Suspect inconnu.');
    const approved = body?.approve ? Number(acc.version) : null;
    await q(
      `insert into accusation_votes (game_id, player_id, suspect_ref, approved_version) values ($1, $2, $3, $4)
       on conflict (game_id, player_id) do update set suspect_ref = coalesce(excluded.suspect_ref, accusation_votes.suspect_ref),
         approved_version = excluded.approved_version, voted_at = now()`,
      [gameId, playerId, suspect, approved],
    );
    events.push(await logEvent(q, gameId, 'accusation.vote', { playerId }, { actor: `player:${playerId}` }));
    return { ok: true };
  });
}

export async function submitAccusation(db: Database, gameId: string, playerId: string | null, actor: string) {
  const out = await withGame(db, gameId, async (q, g, events) => {
    checkAccusationStage(g);
    const [acc] = await q('select * from accusations where game_id = $1 for update', [gameId]);
    if (acc.status === 'submitted') throw new HttpError(409, "L'accusation a déjà été soumise.");
    const players = await q<{ id: string }>('select id from players where game_id = $1 order by joined_at', [gameId]);
    const votes = await q<{ player_id: string; suspect_ref: string | null; approved_version: number | null }>('select * from accusation_votes where game_id = $1', [gameId]);
    let suspect = acc.suspect_ref as string | null;
    const mode = g.settings.accusationMode;
    const byOrganizer = playerId === null;
    if (mode === 'designe' && !byOrganizer) {
      const designated = g.settings.designatedPlayerId ?? players[0]?.id;
      if (designated !== playerId) throw new HttpError(403, "Seul le joueur désigné peut soumettre l'accusation.");
    }
    if (mode === 'collectif' && !byOrganizer) {
      const ok = players.every((p) => votes.find((v) => v.player_id === p.id)?.approved_version === acc.version);
      if (!ok) throw new HttpError(409, 'Tous les enquêteurs doivent approuver la version actuelle de l’accusation.');
    }
    if (mode === 'vote') {
      if (!byOrganizer && !players.every((p) => votes.some((v) => v.player_id === p.id && v.suspect_ref))) throw new HttpError(409, 'Tous les enquêteurs doivent avoir voté.');
      const tally = new Map<string, number>();
      for (const v of votes) if (v.suspect_ref) tally.set(v.suspect_ref, (tally.get(v.suspect_ref) ?? 0) + 1);
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      if (!sorted.length) throw new HttpError(409, 'Aucun vote enregistré.');
      if (sorted[1] && sorted[1][1] === sorted[0][1]) throw new HttpError(409, 'Égalité des votes : débattez encore et revotez.');
      suspect = sorted[0][0];
    }
    if (!suspect) throw new HttpError(400, "L'accusation doit désigner un suspect.");
    const content = await loadVersion(q, g.scenario_version_id);
    const sol = content.solution;
    const keyFound = (sol.keyItems as string[]).filter((r) => (acc.item_refs as string[]).includes(r));
    const result = {
      suspectCorrect: suspect === sol.culprit,
      motiveCorrect: acc.motive === sol.motive,
      keyItemsCited: keyFound,
      keyItemsTotal: sol.keyItems.length,
      score: (suspect === sol.culprit ? 50 : 0) + (acc.motive === sol.motive ? 25 : 0) + Math.round((25 * keyFound.length) / sol.keyItems.length),
    };
    await q(
      `update accusations set status = 'submitted', suspect_ref = $2, submitted_by = $3, submitted_at = now(), result = $4::jsonb where game_id = $1`,
      [gameId, suspect, playerId, JSON.stringify(result)],
    );
    const name = content.characters.find((c) => c.ref === suspect)?.name;
    events.push(await logEvent(q, gameId, 'accusation.submitted', { suspect: name }, { actor }));
    return { autoReveal: g.settings.autoReveal };
  });
  if (out.autoReveal) await organizerAction(db, gameId, 'engine', 'reveal', {});
  return { ok: true };
}
