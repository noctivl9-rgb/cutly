// Diffusion temps réel (Server-Sent Events). Chaque événement est d'abord écrit dans
// game_events : un client qui se reconnecte rattrape tout ce qu'il a manqué à partir de son
// dernier identifiant reçu. La base reste la source de vérité ; le flux n'est qu'un signal.
import type { ServerResponse } from 'node:http';
import type { Query } from './db.ts';

export interface GameEvent {
  id: string;
  game_id: string;
  type: string;
  audience: string;
  actor: string | null;
  payload: any;
  created_at: string;
}

interface Client {
  res: ServerResponse;
  playerId: string | null; // null : organisateur
}

const clients = new Map<string, Set<Client>>();

export function canSee(ev: Pick<GameEvent, 'audience'>, playerId: string | null) {
  if (playerId === null) return true; // l'organisateur voit tout le journal de sa partie
  return ev.audience === 'all' || ev.audience === `player:${playerId}`;
}

export async function logEvent(q: Query, gameId: string, type: string, payload: unknown, opts: { audience?: string; actor?: string | null } = {}) {
  const [row] = await q<GameEvent>(
    `insert into game_events (game_id, type, audience, actor, payload) values ($1, $2, $3, $4, $5::jsonb)
     returning id::text, game_id, type, audience, actor, payload, created_at`,
    [gameId, type, opts.audience ?? 'all', opts.actor ?? null, JSON.stringify(payload ?? {})],
  );
  return row;
}

function write(res: ServerResponse, ev: GameEvent) {
  res.write(`id: ${ev.id}\nevent: game\ndata: ${JSON.stringify({ id: ev.id, type: ev.type, payload: ev.payload, actor: ev.actor, at: ev.created_at })}\n\n`);
}

/** À appeler APRÈS la validation de la transaction qui a créé les événements. */
export function publish(events: Array<GameEvent | undefined>) {
  for (const ev of events) {
    if (!ev) continue;
    for (const c of clients.get(ev.game_id) ?? []) if (canSee(ev, c.playerId)) write(c.res, ev);
  }
}

/** Signal éphémère (non journalisé), par exemple un changement de présence. */
export function publishTransient(gameId: string, type: string, organizerOnly: boolean) {
  for (const c of clients.get(gameId) ?? []) {
    if (organizerOnly && c.playerId !== null) continue;
    c.res.write(`event: transient\ndata: ${JSON.stringify({ type })}\n\n`);
  }
}

export function presence(gameId: string) {
  const ids = new Set<string>();
  for (const c of clients.get(gameId) ?? []) if (c.playerId) ids.add(c.playerId);
  return ids;
}

export async function openStream(q: Query, res: ServerResponse, gameId: string, playerId: string | null, sinceId: string | null, onPresence: () => void) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const client: Client = { res, playerId };
  // Rattrapage des événements manqués
  if (sinceId && /^\d+$/.test(sinceId)) {
    const missed = await q<GameEvent>(
      `select id::text, game_id, type, audience, actor, payload, created_at from game_events
       where game_id = $1 and game_events.id > $2::bigint order by game_events.id limit 500`,
      [gameId, sinceId],
    );
    for (const ev of missed) if (canSee(ev, playerId)) write(res, ev);
  }
  res.write(`event: ready\ndata: {}\n\n`);
  let set = clients.get(gameId);
  if (!set) clients.set(gameId, (set = new Set()));
  set.add(client);
  onPresence();
  const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
  res.on('close', () => {
    clearInterval(ping);
    set!.delete(client);
    if (!set!.size) clients.delete(gameId);
    onPresence();
  });
}

export function closeAll() {
  for (const set of clients.values()) for (const c of set) c.res.end();
  clients.clear();
}
