// Tests de validation obligatoires (cahier des charges §22), exécutés contre une instance
// réelle : serveur HTTP + PostgreSQL (PGlite), sans simulation des opérations testées.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { CHARACTERS, openStream, startApp, type TestApp } from './helpers.ts';
import { grandHotel } from '../src/scenario/grand-hotel.ts';

process.env.DX_RATE_LIMIT_SCALE = '100';

let app: TestApp;
let adminToken: string;

async function createGame(settings: Record<string, unknown> = {}, maxPlayers = 6) {
  const r = await app.j('/api/games', { method: 'POST', body: { scenario: 'grand-hotel', maxPlayers, settings: { progression: 'organisateur', ...settings } } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data as { gameId: string; code: string; organizerToken: string; inviteUrl: string };
}

async function joinSix(code: string) {
  const players: any[] = [];
  for (const [i, ref] of CHARACTERS.entries()) {
    const r = await app.j('/api/join', { method: 'POST', body: { code, nickname: `Joueur${i + 1}`, characterRef: ref } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    players.push(r.data);
  }
  return players as Array<{ gameId: string; playerId: string; token: string; recoveryCode: string; characterRef: string }>;
}

const org = (g: { gameId: string; organizerToken: string }, action: string, body: unknown = {}) =>
  app.j(`/api/games/${g.gameId}/organizer/${action}`, { method: 'POST', organizer: g.organizerToken, body });

before(async () => {
  app = await startApp();
  const r = await app.j('/api/admin/login', { method: 'POST', body: { email: 'admin@dossier-x.test', password: 'mot-de-passe-de-test-123' } });
  assert.equal(r.status, 200);
  adminToken = r.data.token;
});
after(async () => {
  await app.close();
});

describe('DOSSIER X — parcours essentiels', () => {
  let g: Awaited<ReturnType<typeof createGame>>;
  let players: Awaited<ReturnType<typeof joinSix>>;

  it('01 · création réelle d’une partie (code unique, jeton organisateur distinct)', async () => {
    g = await createGame();
    assert.match(g.code, /^DX-\d{4,6}$/);
    assert.ok(g.organizerToken.startsWith('org_') && g.organizerToken.length > 40);
    assert.ok(g.inviteUrl.includes(`/rejoindre/${g.code}?i=`));
    const lookup = await app.j(`/api/games/lookup/${g.code}`);
    assert.equal(lookup.data.title, 'Le Mystère du Grand Hôtel', 'titre récupéré automatiquement');
    assert.equal(lookup.data.characters.length, 6);
    // Le code seul ne donne aucun droit d'organisateur
    const denied = await app.j(`/api/games/${g.gameId}/organizer`, { organizer: g.code });
    assert.equal(denied.status, 403);
  });

  it('02 · connexion de six joueurs', async () => {
    players = await joinSix(g.code);
    const st = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.equal(st.data.players.length, 6);
    const full = await app.j('/api/join', { method: 'POST', body: { code: g.code, nickname: 'Septième', characterRef: 'PER-HELENE' } });
    assert.equal(full.status, 409, 'partie complète');
  });

  it('03 · attribution unique des personnages (y compris en concurrence)', async () => {
    const g2 = await createGame();
    const attempts = await Promise.all(Array.from({ length: 8 }, (_, i) => app.j('/api/join', { method: 'POST', body: { code: g2.code, nickname: `Rival${i}`, characterRef: 'PER-ARTHUR' } })));
    const ok = attempts.filter((a) => a.status === 200);
    assert.equal(ok.length, 1, 'un seul joueur obtient le personnage');
    assert.ok(attempts.filter((a) => a.status === 409).every((a) => /déjà attribué/.test(a.data.error)));
    const lookup = await app.j(`/api/games/lookup/${g2.code}`);
    assert.equal(lookup.data.characters.find((c: any) => c.ref === 'PER-ARTHUR').available, false);
    // Attribution automatique : six joueurs, six personnages distincts
    const g3 = await createGame({ assignment: 'auto' });
    const auto = await Promise.all(Array.from({ length: 6 }, (_, i) => app.j('/api/join', { method: 'POST', body: { code: g3.code, nickname: `Auto${i}` } })));
    assert.ok(auto.every((a) => a.status === 200));
    assert.equal(new Set(auto.map((a) => a.data.characterRef)).size, 6);
  });

  it('04 · reconnexion après fermeture et récupération par code personnel', async () => {
    const p = players[2];
    // « Fermeture de Safari » : le jeton conservé suffit à retrouver l'état
    const again = await app.j(`/api/games/${g.gameId}/state`, { player: p.token });
    assert.equal(again.status, 200);
    assert.equal(again.data.me.characterRef, 'PER-CAMILLE');
    // Prénom seul : impossible de récupérer le personnage d'un autre
    const byName = await app.j('/api/recover', { method: 'POST', body: { code: g.code, recoveryCode: 'Joueur3' } });
    assert.equal(byName.status, 401);
    const rec = await app.j('/api/recover', { method: 'POST', body: { code: g.code, recoveryCode: p.recoveryCode.toLowerCase().replace('-', ' ') } });
    assert.equal(rec.status, 200);
    assert.equal(rec.data.playerId, p.playerId);
    const old = await app.j(`/api/games/${g.gameId}/state`, { player: p.token });
    assert.equal(old.status, 401, "l'ancien jeton est révoqué");
    players[2] = { ...p, token: rec.data.token };
    const sessions = await app.j('/api/me/sessions', { method: 'POST', body: { players: [rec.data.token, 'pl_faux'] } });
    assert.equal(sessions.data.players.length, 1);
  });

  it('05 · scan d’un QR code de lieu', async () => {
    const lobbyScan = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[0].token, body: { kind: 'lieu', key: 'reception' } });
    assert.equal(lobbyScan.status, 409, 'pas de scan avant le lancement');
    assert.equal((await org(g, 'start')).status, 200);
    const res = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[0].token, body: { kind: 'lieu', key: 'reception' } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.data.type, res.data.ref, res.data.locked], ['lieu', 'LIEU-RECEPTION', false]);
    const locked = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[0].token, body: { kind: 'lieu', key: 'chambres' } });
    assert.equal(locked.data.locked, true);
    const resolve = await app.j('/api/resolve/lieu/reception');
    assert.equal(resolve.data.scenario.slug, 'grand-hotel');
    const unknown = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[0].token, body: { kind: 'lieu', key: 'grenier' } });
    assert.equal(unknown.status, 404);
  });

  it('06 · scan d’un QR code d’indice (accessible, verrouillé, saisie manuelle)', async () => {
    const res = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[1].token, body: { kind: 'indice', key: 'IDX-002' } });
    assert.equal(res.status, 200);
    assert.equal(res.data.locked, false);
    const st = await app.j(`/api/games/${g.gameId}/state`, { player: players[1].token });
    assert.ok(st.data.items.some((i: any) => i.ref === 'IDX-002'));
    // Indice d'étape 2 scanné trop tôt : verrouillé, sans contenu
    const early = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[1].token, body: { kind: 'indice', key: 'IDX-018' } });
    assert.equal(early.data.locked, true);
    assert.ok(!JSON.stringify(early.data).includes('412 000'));
    // Prérequis : la bague de cigare exige d'avoir observé la scène
    const pre = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[1].token, body: { kind: 'indice', key: 'IDX-007' } });
    assert.equal(pre.data.locked, true);
    const manual = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: players[1].token, body: { kind: 'auto', key: 'idx-001' } });
    assert.equal(manual.data.ref, 'IDX-001');
    assert.equal(manual.data.locked, false);
  });

  it('07 · découverte persistante (redémarrage du serveur sur la même base)', async () => {
    const dir = (await import('node:fs/promises')).mkdtemp;
    const tmp = await dir(join((await import('node:os')).tmpdir(), 'dx-persist-'));
    let a = await startApp({ dataDir: tmp });
    const r = await a.j('/api/games', { method: 'POST', body: { scenario: 'grand-hotel', settings: { progression: 'organisateur' } } });
    const p = (await a.j('/api/join', { method: 'POST', body: { code: r.data.code, nickname: 'Persistant', characterRef: 'PER-HELENE' } })).data;
    await a.j(`/api/games/${r.data.gameId}/organizer/start`, { method: 'POST', organizer: r.data.organizerToken, body: { force: true } });
    const found = await a.j(`/api/games/${r.data.gameId}/locations/LIEU-BUREAU/search`, { method: 'POST', player: p.token });
    assert.ok(found.data.found.includes('IDX-001'));
    await a.close({ keepData: true });
    a = await startApp({ dataDir: tmp });
    const st = await a.j(`/api/games/${r.data.gameId}/state`, { player: p.token });
    assert.equal(st.status, 200);
    const item = st.data.items.find((i: any) => i.ref === 'IDX-001');
    assert.ok(item, 'la découverte a survécu au redémarrage');
    assert.equal(item.discoveredBy, p.playerId);
    assert.ok(item.discoveredAt);
    await a.close();
  });

  it('08 · synchronisation temps réel vers les autres joueurs + rattrapage', async () => {
    const watcher = openStream(`${app.base}/api/games/${g.gameId}/stream`, { 'x-dx-player': players[5].token });
    await watcher.ready;
    const res = await app.j(`/api/games/${g.gameId}/locations/LIEU-RESTAURANT/search`, { method: 'POST', player: players[4].token });
    assert.ok(res.data.found.length >= 2);
    const ev = await watcher.waitFor((e) => e.type === 'item.discovered' && e.payload.ref === 'IDX-013');
    assert.equal(ev.payload.by, 'Joueur5');
    watcher.close();
    // Reconnexion avec le dernier identifiant reçu : les événements manqués sont rejoués
    const lastId = ev.id;
    await app.j(`/api/games/${g.gameId}/locations/LIEU-CUISINE/search`, { method: 'POST', player: players[4].token });
    const replay = openStream(`${app.base}/api/games/${g.gameId}/stream?since=${lastId}`, { 'x-dx-player': players[5].token });
    await replay.ready;
    assert.ok(replay.events.some((e) => e.payload.ref === 'TEM-LUCAS'), 'événement manqué rejoué');
    replay.close();
  });

  it('09 · isolation entre deux parties', async () => {
    const other = await createGame();
    const intruder = (await app.j('/api/join', { method: 'POST', body: { code: other.code, nickname: 'Intrus', characterRef: 'PER-JULIEN' } })).data;
    const read = await app.j(`/api/games/${g.gameId}/state`, { player: intruder.token });
    assert.equal(read.status, 403);
    const scan = await app.j(`/api/games/${g.gameId}/scan`, { method: 'POST', player: intruder.token, body: { kind: 'lieu', key: 'hall' } });
    assert.equal(scan.status, 403);
    const stream = await app.raw(`/api/games/${g.gameId}/stream`, {});
    assert.equal(stream.status, 401);
    const crossOrg = await app.j(`/api/games/${g.gameId}/organizer`, { organizer: other.organizerToken });
    assert.equal(crossOrg.status, 403, "l'organisateur d'une partie ne contrôle pas une autre");
    const otherState = await app.j(`/api/games/${other.gameId}/state`, { player: intruder.token });
    assert.equal(otherState.data.items.length, 0, 'les découvertes de la première partie ne fuient pas');
  });

  it('10 · confidentialité des secrets (réseau, fichiers JS, API publiques)', async () => {
    const st = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token }); // Hélène
    const text = JSON.stringify(st.data);
    assert.ok(text.includes("Tu as passé ta vie à faire tourner l'hôtel"), 'sa propre fiche est présente');
    for (const c of grandHotel.characters.filter((c) => c.ref !== 'PER-HELENE')) {
      assert.ok(!text.includes(c.private.biography), `fiche privée de ${c.name} absente`);
      for (const s of c.private.secrets) assert.ok(!text.includes(s), `secret de ${c.name} absent`);
    }
    assert.ok(!text.includes(grandHotel.solution.motiveText), 'solution absente');
    assert.ok(!text.includes('"culprit"'), 'aucun indicateur de coupable');
    assert.ok(!text.includes('DOC-ARTHUR'), 'document personnel d’un autre absent');
    assert.equal(st.data.solution, null);
    // Contenus d'enveloppes scellées et preuves non découvertes absents
    assert.ok(!text.includes('Banque de Normandie'), 'enveloppe scellée non divulguée');
    assert.ok(!text.includes('PARTAGÁS — HABANA'), 'indice non découvert non divulgué');
    assert.ok(!text.includes('je retire à Maître Arthur Delmas'), 'carte physique non scannée non divulguée');
    // Fichiers servis au navigateur
    const files = (await readdir(join(import.meta.dirname, '..', 'public', 'js'), { recursive: true })).filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const body = await (await fetch(`${app.base}/js/${f.replace(/\\/g, '/')}`)).text();
      assert.ok(!body.includes('412 000') && !body.includes('Arthur Delmas'), `${f} ne contient pas la vérité`);
    }
    const pub = JSON.stringify((await app.j('/api/scenarios')).data) + JSON.stringify((await app.j(`/api/games/lookup/${g.code}`)).data) + JSON.stringify((await app.j('/api/resolve/indice/IDX-018')).data);
    assert.ok(!pub.includes('412 000') && !pub.includes('secrets') && !pub.includes('PER-ARTHUR","culprit'));
    // Partage volontaire : enregistré avec l'auteur, l'information et la partie
    const share = await app.j(`/api/games/${g.gameId}/share`, { method: 'POST', player: players[0].token, body: { key: 'helene-tabac' } });
    assert.equal(share.status, 200);
    const forged = await app.j(`/api/games/${g.gameId}/share`, { method: 'POST', player: players[0].token, body: { key: 'camille-silhouette' } });
    assert.equal(forged.status, 404, "impossible de partager l'information d'un autre personnage");
    const seen = await app.j(`/api/games/${g.gameId}/state`, { player: players[3].token });
    const sh = seen.data.shares.find((x: any) => x.key === 'helene-tabac');
    assert.equal(sh.playerId, players[0].playerId);
    assert.equal(sh.characterRef, 'PER-HELENE');
  });

  it('11 · déblocage d’une enveloppe', async () => {
    const playerTry = await app.j(`/api/games/${g.gameId}/organizer/envelope`, { method: 'POST', player: players[0].token, body: { ref: 'ENV-02' } });
    assert.equal(playerTry.status, 403, 'un joueur ne peut pas ouvrir une enveloppe');
    const before = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.equal(before.data.envelopes.find((e: any) => e.ref === 'ENV-02').content, null);
    const watcher = openStream(`${app.base}/api/games/${g.gameId}/stream`, { 'x-dx-player': players[1].token });
    await watcher.ready;
    assert.equal((await org(g, 'envelope', { ref: 'ENV-02' })).status, 200);
    assert.equal((await org(g, 'envelope', { ref: 'ENV-02' })).status, 200, 'idempotent');
    await watcher.waitFor((e) => e.type === 'envelope.opened');
    watcher.close();
    const afterSt = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.ok(afterSt.data.envelopes.find((e: any) => e.ref === 'ENV-02').opened);
    assert.ok(afterSt.data.items.some((i: any) => i.ref === 'IDX-023'), 'le document débloqué rejoint le dossier');
    const orgSt = await app.j(`/api/games/${g.gameId}/organizer`, { organizer: g.organizerToken });
    assert.equal(orgSt.data.journal.filter((e: any) => e.type === 'envelope.opened').length, 1);
  });

  it('12 · modification collaborative du tableau (liens, auteurs, conflits)', async () => {
    const a = await app.j(`/api/games/${g.gameId}/board/items`, { method: 'POST', player: players[0].token, body: { kind: 'indice', ref: 'IDX-001', x: 10, y: 10 } });
    const b = await app.j(`/api/games/${g.gameId}/board/items`, { method: 'POST', player: players[1].token, body: { kind: 'personnage', ref: 'PER-JULIEN', x: 300, y: 10 } });
    assert.equal(a.status, 200);
    const hidden = await app.j(`/api/games/${g.gameId}/board/items`, { method: 'POST', player: players[1].token, body: { kind: 'indice', ref: 'IDX-019' } });
    assert.equal(hidden.status, 403, 'une preuve non découverte ne peut pas être épinglée');
    const link = await app.j(`/api/games/${g.gameId}/board/links`, { method: 'POST', player: players[2].token, body: { fromId: a.data.id, toId: b.data.id, label: 'suspect ?' } });
    assert.equal(link.status, 200);
    const dup = await app.j(`/api/games/${g.gameId}/board/links`, { method: 'POST', player: players[2].token, body: { fromId: a.data.id, toId: b.data.id } });
    assert.equal(dup.status, 409);
    // Deux modifications simultanées sur la même version : une seule passe
    const [u1, u2] = await Promise.all([
      app.j(`/api/games/${g.gameId}/board/items/${a.data.id}`, { method: 'PATCH', player: players[3].token, body: { version: 1, x: 100 } }),
      app.j(`/api/games/${g.gameId}/board/items/${a.data.id}`, { method: 'PATCH', player: players[4].token, body: { version: 1, lane: 'confirme' } }),
    ]);
    assert.deepEqual([u1.status, u2.status].sort(), [200, 409]);
    const conflict = u1.status === 409 ? u1 : u2;
    assert.ok(conflict.data.current, "l'état courant est renvoyé pour résolution");
    const st = await app.j(`/api/games/${g.gameId}/state`, { player: players[5].token });
    const item = st.data.board.items.find((x: any) => x.id === a.data.id);
    assert.equal(item.version, 2);
    assert.ok([players[3].playerId, players[4].playerId].includes(item.updated_by), 'auteur de la modification visible');
    assert.equal(st.data.board.links[0].created_by, players[2].playerId);
    // Notes communes : conflit détecté
    const n1 = await app.j(`/api/games/${g.gameId}/notes`, { method: 'PUT', player: players[0].token, body: { body: 'A', version: 0 } });
    const n2 = await app.j(`/api/games/${g.gameId}/notes`, { method: 'PUT', player: players[1].token, body: { body: 'B', version: 0 } });
    assert.equal(n1.status, 200);
    assert.equal(n2.status, 409);
    assert.equal(n2.data.current.body, 'A');
  });

  it('13 · accusation collective (approbations de toute l’équipe)', async () => {
    const early = await app.j(`/api/games/${g.gameId}/accusation`, { method: 'PUT', player: players[0].token, body: { version: 0, suspectRef: 'PER-ARTHUR' } });
    assert.equal(early.status, 409, "fermée avant l'étape 3");
    await org(g, 'stage', { stage: 3 });
    const save = await app.j(`/api/games/${g.gameId}/accusation`, { method: 'PUT', player: players[0].token, body: {
      version: 0, suspectRef: 'PER-ARTHUR', motive: 'detournement', chronology: '22 h 52 appel ; 23 h 20 coup', itemRefs: ['IDX-001', 'IDX-010', 'IDX-023', 'IDX-019'], contradictions: 'Delmas dit ne pas être sorti', explanation: 'Delmas a tué pour couvrir le détournement.',
    } });
    assert.equal(save.status, 200);
    assert.ok(!save.data.item_refs.includes('IDX-019'), 'seules les preuves découvertes sont retenues');
    for (const p of players.slice(0, 5)) await app.j(`/api/games/${g.gameId}/accusation/vote`, { method: 'POST', player: p.token, body: { approve: true } });
    const notYet = await app.j(`/api/games/${g.gameId}/accusation/submit`, { method: 'POST', player: players[0].token });
    assert.equal(notYet.status, 409, 'il manque une approbation');
    await app.j(`/api/games/${g.gameId}/accusation/vote`, { method: 'POST', player: players[5].token, body: { approve: true } });
    const ok = await app.j(`/api/games/${g.gameId}/accusation/submit`, { method: 'POST', player: players[0].token });
    assert.equal(ok.status, 200);
    const again = await app.j(`/api/games/${g.gameId}/accusation/submit`, { method: 'POST', player: players[1].token });
    assert.equal(again.status, 409);
  });

  it('13b · modes vote et porte-parole', async () => {
    const gv = await createGame({ accusationMode: 'vote', accusationStage: 1 }, 3);
    const pv: any[] = [];
    for (const [i, ref] of CHARACTERS.slice(0, 3).entries()) pv.push((await app.j('/api/join', { method: 'POST', body: { code: gv.code, nickname: `V${i}`, characterRef: ref } })).data);
    await org(gv, 'start');
    await app.j(`/api/games/${gv.gameId}/accusation/vote`, { method: 'POST', player: pv[0].token, body: { suspectRef: 'PER-JULIEN' } });
    await app.j(`/api/games/${gv.gameId}/accusation/vote`, { method: 'POST', player: pv[1].token, body: { suspectRef: 'PER-ARTHUR' } });
    assert.equal((await app.j(`/api/games/${gv.gameId}/accusation/submit`, { method: 'POST', player: pv[0].token })).status, 409, 'tous doivent voter');
    await app.j(`/api/games/${gv.gameId}/accusation/vote`, { method: 'POST', player: pv[2].token, body: { suspectRef: 'PER-ARTHUR' } });
    assert.equal((await app.j(`/api/games/${gv.gameId}/accusation/submit`, { method: 'POST', player: pv[0].token })).status, 200);
    const so = await app.j(`/api/games/${gv.gameId}/organizer`, { organizer: gv.organizerToken });
    assert.equal(so.data.accusation.suspect_ref, 'PER-ARTHUR', 'la majorité désigne le suspect');

    const gd = await createGame({ accusationMode: 'designe', accusationStage: 1 }, 2);
    const pd: any[] = [];
    for (const [i, ref] of CHARACTERS.slice(0, 2).entries()) pd.push((await app.j('/api/join', { method: 'POST', body: { code: gd.code, nickname: `D${i}`, characterRef: ref } })).data);
    await org(gd, 'start', { force: true });
    await org(gd, 'designate', { playerId: pd[1].playerId });
    await app.j(`/api/games/${gd.gameId}/accusation`, { method: 'PUT', player: pd[0].token, body: { version: 0, suspectRef: 'PER-CAMILLE' } });
    assert.equal((await app.j(`/api/games/${gd.gameId}/accusation/submit`, { method: 'POST', player: pd[0].token })).status, 403);
    assert.equal((await app.j(`/api/games/${gd.gameId}/accusation/submit`, { method: 'POST', player: pd[1].token })).status, 200);
  });

  it('14 · révélation contrôlée par l’organisateur', async () => {
    const st = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.equal(st.data.accusation.status, 'submitted');
    assert.equal(st.data.solution, null, 'pas de révélation automatique');
    assert.equal(st.data.accusation.result, undefined, 'le score reste caché');
    const byPlayer = await app.j(`/api/games/${g.gameId}/organizer/reveal`, { method: 'POST', player: players[0].token });
    assert.equal(byPlayer.status, 403);
    assert.equal((await org(g, 'reveal')).status, 200);
    const after = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.equal(after.data.solution.culprit, 'PER-ARTHUR');
    assert.equal(after.data.solution.result.suspectCorrect, true);
    assert.equal(after.data.solution.result.motiveCorrect, true);
    assert.ok(after.data.solution.conclusion.length >= 3);
    assert.ok(after.data.timeline.some((t: any) => t.truth), 'chronologie de la vérité visible après révélation');
    // Mode révélation automatique explicitement choisi
    const ga = await createGame({ autoReveal: true, accusationMode: 'designe', accusationStage: 1 }, 1);
    const pa = (await app.j('/api/join', { method: 'POST', body: { code: ga.code, nickname: 'Solo', characterRef: 'PER-MARGAUX' } })).data;
    await org(ga, 'start', { force: true });
    await app.j(`/api/games/${ga.gameId}/accusation`, { method: 'PUT', player: pa.token, body: { version: 0, suspectRef: 'PER-JULIEN', motive: 'dettes' } });
    await app.j(`/api/games/${ga.gameId}/accusation/submit`, { method: 'POST', player: pa.token });
    const sa = await app.j(`/api/games/${ga.gameId}/state`, { player: pa.token });
    assert.equal(sa.data.solution.result.suspectCorrect, false);
  });

  it('15 · génération de PDF A4', async () => {
    const res = await app.raw('/api/admin/print/pdf', { method: 'POST', admin: adminToken, body: { perPage: 6, cutMarks: true } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const pdf = Buffer.from(await res.arrayBuffer());
    const text = pdf.toString('latin1');
    assert.ok(text.startsWith('%PDF-'));
    assert.ok(text.trimEnd().endsWith('%%EOF'));
    const list = (await app.j('/api/admin/resources', { admin: adminToken })).data.resources;
    const pages = (text.match(/\/Type \/Page\b/g) ?? []).length;
    assert.equal(pages, Math.ceil(list.length / 6), `${list.length} cartes sur ${pages} pages`);
    assert.ok(/\/MediaBox \[0 0 595\.28 841\.89\]/.test(text), 'format A4');
    const one = await app.raw('/api/admin/print/pdf', { method: 'POST', admin: adminToken, body: { ids: [list[0].id], perPage: 9 } });
    assert.equal((Buffer.from(await one.arrayBuffer()).toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
    const check = await app.j('/api/admin/print/check', { method: 'POST', admin: adminToken, body: {} });
    assert.equal(check.data.ready, false, 'sans domaine confirmé, les planches ne sont pas prêtes');
    assert.ok(check.data.results.every((r: any) => r.ok));
  });

  it('16 · lecture des QR codes exportés (PNG décodé, SVG valide)', async () => {
    const list = (await app.j('/api/admin/resources', { admin: adminToken })).data.resources;
    assert.ok(list.length >= 40);
    for (const r of list) {
      const png = await app.raw(`/api/admin/resources/${r.id}/qr?format=png`, { admin: adminToken });
      const img = PNG.sync.read(Buffer.from(await png.arrayBuffer()));
      const decoded = (jsQR as any)(new Uint8ClampedArray(img.data), img.width, img.height);
      assert.ok(decoded, `QR ${r.key} lisible`);
      assert.equal(decoded!.data, r.url);
      const u = new URL(decoded!.data);
      const resolved = await app.j(`/api/resolve/${u.pathname.split('/')[2]}/${u.pathname.split('/')[3]}`);
      assert.equal(resolved.data.ref, r.ref, `QR ${r.key} mène à la bonne ressource`);
    }
    const svg = await (await app.raw(`/api/admin/resources/${list[0].id}/qr?format=svg`, { admin: adminToken })).text();
    assert.ok(svg.startsWith('<svg') && svg.includes('<path'));
  });

  it('17 · protection des routes administrateur', async () => {
    const routes: Array<[string, string]> = [['GET', '/api/admin/scenarios'], ['GET', '/api/admin/games'], ['GET', '/api/admin/resources'], ['POST', '/api/admin/print/pdf'], ['GET', '/api/admin/audit'], ['POST', '/api/admin/admins']];
    for (const [method, path] of routes) {
      assert.equal((await app.j(path, { method })).status, 401, `${path} sans jeton`);
      assert.equal((await app.j(path, { method, organizer: g.organizerToken })).status, 401, `${path} avec jeton organisateur`);
      assert.equal((await app.j(path, { method, admin: 'adm_faux' })).status, 401, `${path} avec faux jeton`);
    }
    // Un auteur ne voit pas les parties
    await app.j('/api/admin/admins', { method: 'POST', admin: adminToken, body: { email: 'auteur@dossier-x.test', password: 'auteur-mot-de-passe', role: 'author' } });
    const author = (await app.j('/api/admin/login', { method: 'POST', body: { email: 'auteur@dossier-x.test', password: 'auteur-mot-de-passe' } })).data.token;
    assert.equal((await app.j('/api/admin/games', { admin: author })).status, 403);
    assert.equal((await app.j(`/api/games/${g.gameId}/organizer`, { admin: author })).status, 403);
    // Un administrateur global peut superviser une partie
    assert.equal((await app.j(`/api/games/${g.gameId}/organizer`, { admin: adminToken })).status, 200);
    // Limitation des tentatives de connexion
    process.env.DX_RATE_LIMIT_SCALE = '1';
    const tries: number[] = [];
    for (let i = 0; i < 10; i++) tries.push((await app.j('/api/admin/login', { method: 'POST', body: { email: 'x@y.fr', password: 'mauvais' } })).status);
    process.env.DX_RATE_LIMIT_SCALE = '100';
    assert.ok(tries.includes(429), 'tentatives limitées');
    // Une version publiée est immuable ; un brouillon ne modifie pas les parties en cours
    const sc = (await app.j('/api/admin/scenarios', { admin: adminToken })).data[0];
    const published = sc.versions.find((v: any) => v.status === 'published');
    const edit = await app.j(`/api/admin/versions/${published.id}/entities/locations`, { method: 'PUT', admin: adminToken, body: { ref: 'LIEU-HALL', sort: 0, name: 'Hall modifié', stage: 1, public: {} } });
    assert.equal(edit.status, 409);
    const draft = (await app.j(`/api/admin/scenarios/${sc.id}/draft`, { method: 'POST', admin: adminToken })).data.versionId;
    const v = (await app.j(`/api/admin/versions/${draft}`, { admin: adminToken })).data;
    const hall = v.locations.find((l: any) => l.ref === 'LIEU-HALL');
    assert.equal((await app.j(`/api/admin/versions/${draft}/entities/locations`, { method: 'PUT', admin: adminToken, body: { ...hall, name: 'Grand hall' } })).status, 200);
    assert.equal((await app.j(`/api/admin/versions/${draft}/publish`, { method: 'POST', admin: adminToken })).status, 200);
    const old = await app.j(`/api/games/${g.gameId}/state`, { player: players[0].token });
    assert.equal(old.data.locations.find((l: any) => l.ref === 'LIEU-HALL').name, 'Hall', 'la partie en cours garde sa version');
    const fresh = await createGame();
    const pf = (await app.j('/api/join', { method: 'POST', body: { code: fresh.code, nickname: 'Nouveau', characterRef: 'PER-HELENE' } })).data;
    const ns = await app.j(`/api/games/${fresh.gameId}/state`, { player: pf.token });
    assert.equal(ns.data.locations.find((l: any) => l.ref === 'LIEU-HALL').name, 'Grand hall', 'les nouvelles parties utilisent la nouvelle version');
    assert.equal(ns.data.scenario.version, 2);
  });

  it('18 · résistance aux actions simultanées', async () => {
    const gs = await createGame({ physicalCards: false });
    const ps = await joinSix(gs.code);
    await org(gs, 'start');
    const watcher = openStream(`${app.base}/api/games/${gs.gameId}/stream`, { 'x-dx-player': ps[0].token });
    await watcher.ready;
    // Six joueurs scannent la même carte et fouillent le même lieu au même instant
    const results = await Promise.all([
      ...ps.map((p) => app.j(`/api/games/${gs.gameId}/scan`, { method: 'POST', player: p.token, body: { kind: 'indice', key: 'IDX-004' } })),
      ...ps.map((p) => app.j(`/api/games/${gs.gameId}/locations/LIEU-BUREAU/search`, { method: 'POST', player: p.token })),
    ]);
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
    await new Promise((r) => setTimeout(r, 300));
    const orgSt = await app.j(`/api/games/${gs.gameId}/organizer`, { organizer: gs.organizerToken });
    const discoveredEvents = orgSt.data.journal.filter((e: any) => e.type === 'item.discovered');
    const refs = discoveredEvents.map((e: any) => e.payload.ref);
    assert.equal(refs.length, new Set(refs).size, 'aucune découverte en double');
    assert.equal(refs.filter((r: string) => r === 'IDX-004').length, 1);
    // Plus de dix événements : l'ordre du journal doit rester numérique (régression « 17 » < « 9 »)
    const ids = orgSt.data.journal.map((e: any) => Number(e.id));
    assert.ok(ids.length > 10);
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'journal trié par identifiant décroissant');
    assert.equal(watcher.events.filter((e) => e.payload.ref === 'IDX-004').length, 1, 'une seule notification');
    watcher.close();
    // Pause : les actions des joueurs sont refusées, la lecture reste possible
    await org(gs, 'pause');
    assert.equal((await app.j(`/api/games/${gs.gameId}/locations/LIEU-HALL/search`, { method: 'POST', player: ps[0].token })).status, 423);
    assert.equal((await app.j(`/api/games/${gs.gameId}/state`, { player: ps[0].token })).status, 200);
    // Une enveloppe ouverte pendant une déconnexion est rattrapée à la reconnexion
    const lastId = (await app.j(`/api/games/${gs.gameId}/state`, { player: ps[1].token })).data.lastEventId;
    await org(gs, 'envelope', { ref: 'ENV-01' });
    await org(gs, 'resume');
    const back = openStream(`${app.base}/api/games/${gs.gameId}/stream?since=${lastId}`, { 'x-dx-player': ps[1].token });
    await back.ready;
    assert.ok(back.events.some((e) => e.type === 'envelope.opened'));
    assert.ok(back.events.some((e) => e.type === 'game.resumed'));
    back.close();
    // Progression automatique concurrente : l'étape n'avance qu'une fois
    const gp = await createGame({ progression: 'auto', physicalCards: false });
    const pp = await joinSix(gp.code);
    await org(gp, 'start');
    const locs = ['LIEU-BUREAU', 'LIEU-RECEPTION', 'LIEU-RESTAURANT', 'LIEU-CUISINE', 'LIEU-HALL', 'LIEU-COULOIRS'];
    await Promise.all(pp.map((p, i) => app.j(`/api/games/${gp.gameId}/locations/${locs[i]}/search`, { method: 'POST', player: p.token })));
    const sp = await app.j(`/api/games/${gp.gameId}/organizer`, { organizer: gp.organizerToken });
    assert.equal(sp.data.game.current_stage, 2);
    assert.equal(sp.data.journal.filter((e: any) => e.type === 'stage.unlocked').length, 1);
  });
});

describe('Scénario — cohérence et résolubilité', () => {
  it('le scénario publié est cohérent et la solution est atteignable avec les seules informations du jeu', async () => {
    const { validateVersion } = await import('../src/services/scenarios.ts');
    const sc = (await app.j('/api/admin/scenarios', { admin: adminToken })).data.find((s: any) => s.slug === 'grand-hotel');
    const v = (await app.j(`/api/admin/versions/${sc.versions.at(-1).id}`, { admin: adminToken })).data;
    assert.deepEqual(validateVersion(v), []);
    // Toutes les preuves clés sont découvrables sans carte physique (fouille ou enveloppe)
    const items = new Map(grandHotel.items.map((i) => [i.ref, i]));
    for (const ref of grandHotel.solution.keyItems) {
      const modes = items.get(ref)!.discovery.modes;
      assert.ok(modes.includes('search') || modes.includes('envelope'), `${ref} accessible sans impression`);
    }
    assert.equal(grandHotel.characters.length, 6);
    assert.equal(grandHotel.characters.filter((c) => c.truth.culprit).length, 1);
    assert.equal(grandHotel.characters.find((c) => c.truth.culprit)!.ref, grandHotel.solution.culprit);
    for (const c of grandHotel.characters) for (const k of ['biography', 'secrets', 'motivations', 'objectives', 'realMovements']) assert.ok(c.private[k], `${c.ref}.${k}`);
    // Partie complète jouée de bout en bout sans cartes physiques
    const gf = await createGame({ physicalCards: false, progression: 'auto' });
    const pf = await joinSix(gf.code);
    await org(gf, 'start');
    const search = (loc: string) => app.j(`/api/games/${gf.gameId}/locations/${loc}/search`, { method: 'POST', player: pf[0].token });
    for (const l of ['LIEU-BUREAU', 'LIEU-RECEPTION', 'LIEU-RESTAURANT', 'LIEU-CUISINE', 'LIEU-SALON', 'LIEU-HALL', 'LIEU-COULOIRS', 'LIEU-ESCALIER']) await search(l);
    await org(gf, 'envelope', { ref: 'ENV-01' });
    await org(gf, 'envelope', { ref: 'ENV-02' });
    for (const l of ['LIEU-CHAMBRES', 'LIEU-RESERVE', 'LIEU-BUREAU']) await search(l);
    let st = await app.j(`/api/games/${gf.gameId}/organizer`, { organizer: gf.organizerToken });
    assert.equal(st.data.game.current_stage, 3, 'progression automatique jusqu’aux aveux');
    await org(gf, 'envelope', { ref: 'ENV-03' });
    await org(gf, 'envelope', { ref: 'ENV-04' });
    st = await app.j(`/api/games/${gf.gameId}/state`, { player: pf[0].token });
    const found = new Set(st.data.items.map((i: any) => i.ref));
    for (const ref of grandHotel.solution.keyItems) assert.ok(found.has(ref), `${ref} découverte`);
  });
});
