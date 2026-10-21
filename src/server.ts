// DOSSIER X — serveur HTTP (API + application web).
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openDatabase, type Database } from './db.ts';
import { HttpError, Router, clientIp, rateLimit, readJson, securityHeaders, sendJson, serveStatic, type Ctx } from './http.ts';
import { createAdmin, getOrganizer, getPlayer, hashToken, loginAdmin, requireAdmin, requireOrganizer, requirePlayer } from './auth.ts';
import { closeAll, openStream, publishTransient } from './realtime.ts';
import { grandHotel } from './scenario/grand-hotel.ts';
import { audit, createDraft, createScenario, deleteEntity, importScenario, loadVersion, publishVersion, updateMeta, upsertEntity, validateVersion } from './services/scenarios.ts';
import {
  createGame, getGame, joinGame, leaveGame, lookupGame, normalizeCode, organizerAction, recoverPlayer, resolveResource, scan, searchLocation, setReady, shareInfo,
} from './services/games.ts';
import { createBoardItem, createBoardLink, deleteBoardItem, deleteBoardLink, saveAccusation, saveNotes, submitAccusation, updateBoardItem, voteAccusation } from './services/collab.ts';
import { exportGame, organizerState, playerState } from './services/state.ts';
import { checkOnline, checkResources, domainStatus, listResources, publicBaseUrl, qrPng, qrSvg, renderSheet } from './services/print.ts';

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public');
const SPA_ROUTES = /^\/(creer|rejoindre|recuperer|partie|organisateur|admin|q)(\/|$)/;

export async function createApp(opts: { db?: Database; dataDir?: string } = {}) {
  const db = opts.db ?? (await openDatabase({ dataDir: opts.dataDir }));
  await importScenario(db, grandHotel, { publish: true });
  if (process.env.DX_ADMIN_EMAIL && process.env.DX_ADMIN_PASSWORD) {
    const exists = await db.one('select 1 from admins limit 1');
    if (!exists) await createAdmin(db, process.env.DX_ADMIN_EMAIL, process.env.DX_ADMIN_PASSWORD, 'superadmin');
  }

  const r = new Router();
  const limit = (ctx: Ctx, name: string, max: number, windowMs: number, extra = '') => rateLimit(`${name}:${ctx.ip}:${extra}`, max, windowMs);

  // ── Public ──
  r.get('/api/health', async () => ({ ok: true, db: db.kind, time: new Date().toISOString() }));

  r.get('/api/config', () => ({ publicBaseUrl: publicBaseUrl() || null }));

  r.get('/api/scenarios', async () => {
    const rows = await db.q(
      `select distinct on (s.id) s.slug, s.case_number, v.id, v.version, v.title, v.synopsis, v.objective, v.difficulty, v.duration_minutes, v.min_players, v.max_players
       from scenarios s join scenario_versions v on v.scenario_id = s.id and v.status = 'published' order by s.id, v.version desc`,
    );
    return rows.map((v) => ({ slug: v.slug, caseNumber: v.case_number, version: v.version, title: v.title, synopsis: v.synopsis, objective: v.objective, difficulty: v.difficulty, durationMinutes: v.duration_minutes, minPlayers: v.min_players, maxPlayers: v.max_players }));
  });

  r.get('/api/resolve/:kind/:key', async (ctx) => {
    limit(ctx, 'resolve', 120, 60_000);
    const res = await resolveResource(db.q, ctx.params.kind, ctx.params.key);
    if (!res) throw new HttpError(404, 'Ce QR code ne correspond à aucune ressource connue.');
    const s = await db.one(
      `select s.slug, s.case_number, v.id as version_id, v.title from scenarios s join scenario_versions v on v.scenario_id = s.id
       where s.id = $1 and v.status = 'published' order by v.version desc limit 1`,
      [res.scenario_id],
    );
    let label = res.ref;
    if (s && res.kind === 'lieu') label = (await loadVersion(db.q, s.version_id)).locations.find((l) => l.ref === res.ref)?.name ?? res.ref;
    return { kind: res.kind, key: res.key, ref: res.ref, label, scenario: s ? { slug: s.slug, caseNumber: s.case_number, title: s.title } : null };
  });

  r.post('/api/games', async (ctx) => {
    limit(ctx, 'create', 12, 3600_000);
    const admin = await getAdminSafe(ctx);
    const { game, organizerToken } = await createGame(db, await ctx.body(), admin?.id ?? null);
    return { gameId: game.id, code: game.code, organizerToken, inviteUrl: inviteUrl(game) };
  });

  r.get('/api/games/lookup/:code', async (ctx) => {
    limit(ctx, 'lookup', 60, 60_000);
    return lookupGame(db, ctx.params.code);
  });

  r.post('/api/join', async (ctx) => {
    limit(ctx, 'join', 20, 60_000);
    return joinGame(db, await ctx.body());
  });

  r.post('/api/recover', async (ctx) => {
    const body = await ctx.body();
    limit(ctx, 'recover', 8, 15 * 60_000);
    rateLimit(`recover-code:${normalizeCode(body?.code)}`, 20, 15 * 60_000);
    return recoverPlayer(db, body);
  });

  // Reprendre : valide les jetons conservés sur l'appareil
  r.post('/api/me/sessions', async (ctx) => {
    limit(ctx, 'sessions', 60, 60_000);
    const body = await ctx.body();
    const tokens: string[] = (Array.isArray(body?.players) ? body.players : []).slice(0, 20).map(String);
    const orgs: Array<{ gameId: string; token: string }> = (Array.isArray(body?.organizers) ? body.organizers : []).slice(0, 20);
    const players = tokens.length
      ? await db.q(
          `select p.id as player_id, p.nickname, p.character_ref, p.token_hash, g.id as game_id, g.code, g.status, s.slug, v.title
           from players p join games g on g.id = p.game_id join scenario_versions v on v.id = g.scenario_version_id join scenarios s on s.id = v.scenario_id
           where p.token_hash = any($1::text[])`,
          [tokens.map(hashToken)],
        )
      : [];
    const organizers: any[] = [];
    for (const o of orgs) {
      if (!/^[0-9a-f-]{36}$/i.test(String(o?.gameId))) continue;
      const row = await db.one(
        `select g.id as game_id, g.code, g.status, v.title, s.slug from game_organizers go join games g on g.id = go.game_id
         join scenario_versions v on v.id = g.scenario_version_id join scenarios s on s.id = v.scenario_id
         where go.token_hash = $1 and go.game_id = $2`,
        [hashToken(String(o.token ?? '')), o.gameId],
      );
      if (row) organizers.push(row);
    }
    return {
      players: players.map((p) => ({ tokenIndex: tokens.findIndex((t) => hashToken(t) === p.token_hash), playerId: p.player_id, nickname: p.nickname, characterRef: p.character_ref, gameId: p.game_id, code: p.code, status: p.status, scenario: p.slug, title: p.title })),
      organizers,
    };
  });

  // ── Joueur ──
  r.get('/api/games/:id/state', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return playerState(db, ctx.params.id, p.id);
  });

  r.get('/api/games/:id/stream', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    await openStream(db.q, ctx.res, ctx.params.id, p.id, ctx.url.searchParams.get('since') ?? (ctx.req.headers['last-event-id'] as string) ?? null, () => presenceChanged(ctx.params.id));
    return STREAM;
  });

  r.post('/api/games/:id/ready', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    await setReady(db, ctx.params.id, p.id, (await ctx.body())?.ready !== false);
    return { ok: true };
  });

  r.post('/api/games/:id/leave', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    await leaveGame(db, ctx.params.id, p.id);
    return { ok: true };
  });

  r.post('/api/games/:id/scan', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    rateLimit(`scan:${p.id}`, 40, 60_000);
    const body = await ctx.body();
    return scan(db, ctx.params.id, p, String(body?.kind ?? ''), String(body?.key ?? ''));
  });

  r.post('/api/games/:id/locations/:ref/search', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    rateLimit(`search:${p.id}`, 40, 60_000);
    return searchLocation(db, ctx.params.id, p.id, ctx.params.ref);
  });

  r.post('/api/games/:id/share', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    await shareInfo(db, ctx.params.id, p.id, String((await ctx.body())?.key ?? ''));
    return { ok: true };
  });

  r.post('/api/games/:id/board/items', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return createBoardItem(db, ctx.params.id, p.id, await ctx.body());
  });
  r.patch('/api/games/:id/board/items/:itemId', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return updateBoardItem(db, ctx.params.id, p.id, ctx.params.itemId, await ctx.body());
  });
  r.delete('/api/games/:id/board/items/:itemId', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return deleteBoardItem(db, ctx.params.id, p.id, ctx.params.itemId);
  });
  r.post('/api/games/:id/board/links', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return createBoardLink(db, ctx.params.id, p.id, await ctx.body());
  });
  r.delete('/api/games/:id/board/links/:linkId', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return deleteBoardLink(db, ctx.params.id, p.id, ctx.params.linkId);
  });

  r.put('/api/games/:id/notes', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return saveNotes(db, ctx.params.id, p.id, await ctx.body());
  });

  r.put('/api/games/:id/accusation', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return saveAccusation(db, ctx.params.id, p.id, await ctx.body());
  });
  r.post('/api/games/:id/accusation/vote', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return voteAccusation(db, ctx.params.id, p.id, await ctx.body());
  });
  r.post('/api/games/:id/accusation/submit', async (ctx) => {
    const p = await requirePlayer(db, ctx.req, ctx.params.id);
    return submitAccusation(db, ctx.params.id, p.id, `player:${p.id}`);
  });

  // ── Organisateur ──
  r.get('/api/games/:id/organizer', async (ctx) => {
    await requireOrganizer(db, ctx.req, ctx.params.id);
    return organizerState(db, ctx.params.id);
  });
  r.get('/api/games/:id/organizer/stream', async (ctx) => {
    await requireOrganizer(db, ctx.req, ctx.params.id);
    await openStream(db.q, ctx.res, ctx.params.id, null, ctx.url.searchParams.get('since'), () => {});
    return STREAM;
  });
  r.post('/api/games/:id/organizer/accusation/submit', async (ctx) => {
    const org = await requireOrganizer(db, ctx.req, ctx.params.id);
    return submitAccusation(db, ctx.params.id, null, org.actor);
  });
  r.post('/api/games/:id/organizer/:action', async (ctx) => {
    const org = await requireOrganizer(db, ctx.req, ctx.params.id);
    return organizerAction(db, ctx.params.id, org.actor, ctx.params.action, await ctx.body());
  });
  r.get('/api/games/:id/export', async (ctx) => {
    const org = await requireOrganizer(db, ctx.req, ctx.params.id);
    await audit(db.q, org.actor, 'game.export', ctx.params.id, {});
    const data = await exportGame(db, ctx.params.id);
    ctx.res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="dossier-x-${data.game.code}.json"`, 'cache-control': 'no-store' });
    ctx.res.end(JSON.stringify(data, null, 2));
    return STREAM;
  });
  r.get('/api/games/:id/invite.svg', async (ctx) => {
    await requireOrganizer(db, ctx.req, ctx.params.id);
    const g = await getGame(db.q, ctx.params.id);
    ctx.res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
    ctx.res.end(await qrSvg(inviteUrl(g)));
    return STREAM;
  });

  // ── Administration ──
  r.post('/api/admin/login', async (ctx) => {
    const body = await ctx.body();
    limit(ctx, 'admin-login', 8, 15 * 60_000);
    const token = await loginAdmin(db, body?.email, body?.password);
    await audit(db.q, `admin:${String(body?.email).toLowerCase()}`, 'admin.login', null, { ip: ctx.ip });
    return { token };
  });
  r.post('/api/admin/logout', async (ctx) => {
    const token = String(ctx.req.headers['x-dx-admin'] ?? '');
    if (token) await db.q('delete from admin_sessions where token_hash = $1', [hashToken(token)]);
    return { ok: true };
  });
  r.get('/api/admin/me', async (ctx) => requireAdmin(db, ctx.req));
  r.post('/api/admin/admins', async (ctx) => {
    const a = await requireAdmin(db, ctx.req, ['superadmin']);
    const b = await ctx.body();
    const id = await createAdmin(db, String(b?.email ?? ''), String(b?.password ?? ''), b?.role === 'superadmin' ? 'superadmin' : 'author');
    await audit(db.q, `admin:${a.id}`, 'admin.create', id, { email: b?.email, role: b?.role });
    return { id };
  });

  r.get('/api/admin/scenarios', async (ctx) => {
    await requireAdmin(db, ctx.req);
    const rows = await db.q(
      `select s.id, s.slug, s.case_number, v.id as version_id, v.version, v.status, v.title, v.published_at,
         (select count(*)::int from games g where g.scenario_version_id = v.id) as games
       from scenarios s join scenario_versions v on v.scenario_id = s.id order by s.case_number, v.version desc`,
    );
    const map = new Map<string, any>();
    for (const r0 of rows) {
      if (!map.has(r0.id)) map.set(r0.id, { id: r0.id, slug: r0.slug, caseNumber: r0.case_number, versions: [] });
      map.get(r0.id).versions.push({ id: r0.version_id, version: r0.version, status: r0.status, title: r0.title, publishedAt: r0.published_at, games: r0.games });
    }
    return [...map.values()];
  });
  r.post('/api/admin/scenarios', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    return createScenario(db, await ctx.body(), a.id);
  });
  r.post('/api/admin/scenarios/:id/draft', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    return { versionId: await createDraft(db, ctx.params.id, a.id) };
  });
  r.get('/api/admin/versions/:vid', async (ctx) => {
    await requireAdmin(db, ctx.req);
    const c = await loadVersion(db.q, ctx.params.vid);
    return { ...c, errors: validateVersion(c) };
  });
  r.put('/api/admin/versions/:vid/meta', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    await updateMeta(db, ctx.params.vid, await ctx.body(), a.id);
    return { ok: true };
  });
  r.put('/api/admin/versions/:vid/entities/:entity', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    await upsertEntity(db, ctx.params.vid, ctx.params.entity, await ctx.body(), a.id);
    return { ok: true };
  });
  r.delete('/api/admin/versions/:vid/entities/:entity/:key', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    await deleteEntity(db, ctx.params.vid, ctx.params.entity, ctx.params.key, a.id);
    return { ok: true };
  });
  r.post('/api/admin/versions/:vid/publish', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    await db.tx((q) => publishVersion(q, ctx.params.vid, a.id));
    return { ok: true };
  });

  r.get('/api/admin/games', async (ctx) => {
    await requireAdmin(db, ctx.req, ['superadmin']);
    return db.q(
      `select g.id, g.code, g.status, g.current_stage, g.created_at, g.started_at, g.ended_at, v.title, v.version, s.slug,
         (select count(*)::int from players p where p.game_id = g.id) as players,
         (select count(*)::int from discoveries d where d.game_id = g.id) as discoveries
       from games g join scenario_versions v on v.id = g.scenario_version_id join scenarios s on s.id = v.scenario_id
       order by g.created_at desc limit 200`,
    );
  });
  r.get('/api/admin/audit', async (ctx) => {
    await requireAdmin(db, ctx.req, ['superadmin']);
    return db.q('select * from audit_log order by id desc limit 200');
  });

  r.get('/api/admin/resources', async (ctx) => {
    await requireAdmin(db, ctx.req);
    const scenario = ctx.url.searchParams.get('scenario') ?? undefined;
    return { domain: domainStatus(), resources: await listResources(db.q, scenario || undefined) };
  });
  r.post('/api/admin/aliases', async (ctx) => {
    const a = await requireAdmin(db, ctx.req, ['superadmin']);
    const b = await ctx.body();
    if (!/^[a-z]+$/.test(b?.kind) || !/^[A-Za-z0-9._-]{1,60}$/.test(b?.key)) throw new HttpError(400, 'Alias invalide.');
    if (await resolveResource(db.q, b.kind, b.key)) throw new HttpError(409, 'Cette adresse est déjà utilisée.');
    await db.q('insert into resource_aliases (kind, key, resource_id) values ($1, $2, $3)', [b.kind, b.key, b.resourceId]);
    await audit(db.q, `admin:${a.id}`, 'resource.alias', b.resourceId, b);
    return { ok: true };
  });
  const selected = async (ids: unknown) => {
    const all = await listResources(db.q);
    const set = new Set(Array.isArray(ids) ? ids.map(String) : []);
    return set.size ? all.filter((x) => set.has(x.id)) : all;
  };
  r.get('/api/admin/resources/:rid/qr', async (ctx) => {
    await requireAdmin(db, ctx.req);
    const res = (await listResources(db.q)).find((x) => x.id === ctx.params.rid);
    if (!res) throw new HttpError(404, 'Ressource introuvable');
    const format = ctx.url.searchParams.get('format') === 'svg' ? 'svg' : 'png';
    const name = `dossier-x-${res.kind}-${res.key}.${format}`;
    ctx.res.writeHead(200, { 'content-type': format === 'svg' ? 'image/svg+xml' : 'image/png', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' });
    ctx.res.end(format === 'svg' ? await qrSvg(res.url) : await qrPng(res.url));
    return STREAM;
  });
  r.post('/api/admin/print/check', async (ctx) => {
    await requireAdmin(db, ctx.req);
    return checkResources(db.q, await selected((await ctx.body())?.ids));
  });
  r.post('/api/admin/print/check-online', async (ctx) => {
    await requireAdmin(db, ctx.req);
    return checkOnline(await selected((await ctx.body())?.ids));
  });
  r.post('/api/admin/print/pdf', async (ctx) => {
    const a = await requireAdmin(db, ctx.req);
    const b = await ctx.body();
    const list = await selected(b?.ids);
    const pdf = await renderSheet(list, { perPage: Number(b?.perPage) || 6, cutMarks: b?.cutMarks !== false });
    await audit(db.q, `admin:${a.id}`, 'print.pdf', null, { count: list.length, final: domainStatus().final });
    ctx.res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="dossier-x-planches.pdf"', 'content-length': pdf.length, 'cache-control': 'no-store' });
    ctx.res.end(pdf);
    return STREAM;
  });
  r.post('/api/admin/games', async (ctx) => {
    const a = await requireAdmin(db, ctx.req, ['superadmin']);
    const { game, organizerToken } = await createGame(db, await ctx.body(), a.id);
    return { gameId: game.id, code: game.code, organizerToken, inviteUrl: inviteUrl(game) };
  });

  // ── Helpers ──
  async function getAdminSafe(ctx: Ctx) {
    try {
      return await requireAdmin(db, ctx.req, ['superadmin']);
    } catch {
      return null;
    }
  }
  function inviteUrl(g: { code: string; invite_token: string }) {
    return `${publicBaseUrl() || ''}/rejoindre/${g.code}?i=${g.invite_token}`;
  }
  const presenceTimers = new Map<string, NodeJS.Timeout>();
  function presenceChanged(gameId: string) {
    // Signal éphémère regroupé : la présence n'est pas journalisée.
    clearTimeout(presenceTimers.get(gameId));
    presenceTimers.set(gameId, setTimeout(() => {
      presenceTimers.delete(gameId);
      publishTransient(gameId, 'presence', false);
    }, 1000).unref());
  }

  const indexHtml = () => readFile(join(PUBLIC_DIR, 'index.html'));

  const server: Server = createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = clientIp(req);
    let parsed: any;
    const ctx: Ctx = { req, res, url, params: {}, ip, body: async () => (parsed ??= await readJson(req)) };
    try {
      if (url.pathname.startsWith('/api/')) {
        const m = r.match(req.method ?? 'GET', url.pathname);
        if (!m) throw new HttpError(404, 'Route inconnue');
        ctx.params = m.params;
        const out = await m.handler(ctx);
        if (out !== STREAM) sendJson(res, 200, out ?? { ok: true });
        return;
      }
      // Redirection maîtrisée des anciennes routes QR
      const legacy = /^\/(?:qr|r)\/([a-z]+)\/([^/]+)$/.exec(url.pathname);
      if (legacy) {
        res.writeHead(301, { location: `/q/${legacy[1]}/${legacy[2]}` });
        res.end();
        return;
      }
      if (req.method === 'GET' && (url.pathname === '/' || SPA_ROUTES.test(url.pathname))) {
        const html = await indexHtml();
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(html);
        return;
      }
      if (req.method === 'GET' && (await serveStatic(res, PUBLIC_DIR, url.pathname))) return;
      throw new HttpError(404, 'Page introuvable');
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof HttpError) {
        if (err.status === 429) res.setHeader('retry-after', Math.ceil(Number(err.extra?.retryAfterMs ?? 60000) / 1000));
        return sendJson(res, err.status, { error: err.message, ...(err.extra ?? {}) });
      }
      console.error(err);
      sendJson(res, 500, { error: 'Erreur interne. Réessayez dans un instant.' });
    }
  });
  server.on('close', closeAll);
  return { server, db };
}

const STREAM = Symbol('stream');

// Lancement direct : node src/server.ts
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { server, db } = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => {
    console.log(`DOSSIER X prêt sur http://localhost:${port} (base : ${db.kind})`);
    if (!publicBaseUrl()) console.log('PUBLIC_BASE_URL non défini : les QR codes ne sont pas prêts à imprimer.');
  });
  const stop = async () => {
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

export { getOrganizer, getPlayer };
