const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('lien privé administrateur : 24 h, réutilisable, révoqué par le suivant, haché en base, ouvre une session', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-admin-link-'));
  const key = crypto.randomBytes(32);
  Object.assign(process.env, { NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), CUTLY_MFA_ENCRYPTION_KEY: key.toString('base64'), CUTLY_BOOTSTRAP_ADMIN_EMAIL: 'thomas@example.org', CUTLY_BOOTSTRAP_ADMIN_PASSWORD: 'mot-de-passe-correct-2030' });
  for (const name of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY']) delete process.env[name];
  const { db, databaseReady, server } = require('../server');
  const { createAdminLink, consumeAdminLink, revokeAdminLinks } = require('../lib/admin-links');
  try {
    await databaseReady;
    const originalLog = console.log; console.log = () => {};
    try { await require('../scripts/bootstrap-admin').main(); } finally { console.log = originalLog; }
    const now = new Date('2030-01-01T10:00:00Z');
    const first = await createAdminLink(db, { email: 'Thomas@example.org', key, now });
    assert.match(first.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(first.expiresAt, '2030-01-02T10:00:00.000Z');
    const stored = await db.prepare('SELECT token_hash FROM admin_login_links').get();
    assert.notEqual(stored.token_hash, first.token, 'seul le haché est stocké');
    assert.ok(await consumeAdminLink(db, { token: first.token, key, now }));
    assert.ok(await consumeAdminLink(db, { token: first.token, key, now: new Date('2030-01-02T09:59:00Z') }), 'réutilisable pendant 24 h');
    assert.equal(await consumeAdminLink(db, { token: first.token, key, now: new Date('2030-01-02T10:00:01Z') }), null, 'expiré');
    assert.equal(await consumeAdminLink(db, { token: first.token, key: crypto.randomBytes(32), now }), null, 'autre clé');
    const second = await createAdminLink(db, { email: 'thomas@example.org', key, now });
    assert.equal(await consumeAdminLink(db, { token: first.token, key, now }), null, 'l’ancien est révoqué');
    assert.ok(await consumeAdminLink(db, { token: second.token, key, now }));
    await assert.rejects(createAdminLink(db, { email: 'client@example.org', key, now }), /Aucun administrateur/);

    // Par HTTP : session administrateur ouverte, lien faux refusé, origine étrangère refusée.
    const live = await createAdminLink(db, { email: 'thomas@example.org', key });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (token, origin = base) => fetch(`${base}/api/auth/admin/link`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ token }) });
    assert.equal((await post('x'.repeat(43))).status, 401);
    assert.equal((await post(live.token, 'https://ailleurs.example')).status, 403);
    const ok = await post(live.token);
    assert.equal(ok.status, 200);
    const cookie = ok.headers.get('set-cookie').split(';')[0];
    const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
    assert.equal(session.status, 200);
    assert.equal((await session.json()).user.role, 'ESTABLISHMENT_ADMIN');
    assert.equal(await revokeAdminLinks(db, { email: 'thomas@example.org' }), 1);
    assert.equal((await post(live.token)).status, 401, 'révoqué');
  } finally {
    await new Promise(resolve => server.listening ? server.close(resolve) : resolve());
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('liens permanents : seule l’empreinte est configurée, un lien par personne, retirable', () => {
  const crypto = require('node:crypto');
  const { standingAdminLink } = require('../lib/admin-links');
  const me = crypto.randomBytes(32).toString('base64url'), partner = crypto.randomBytes(32).toString('base64url');
  const hash = token => crypto.createHash('sha256').update(token).digest('hex');
  const config = `moi:${hash(me)},associe:${hash(partner)}`;
  assert.equal(standingAdminLink(me, config), 'moi');
  assert.equal(standingAdminLink(partner, config), 'associe');
  assert.equal(standingAdminLink(crypto.randomBytes(32).toString('base64url'), config), null);
  assert.equal(standingAdminLink(partner, `moi:${hash(me)}`), null, 'lien retiré');
  assert.equal(standingAdminLink(me, ''), null);
  assert.equal(standingAdminLink('court', config), null);
  assert.ok(!config.includes(me) && !config.includes(partner), 'aucun secret en clair dans la configuration');
});
