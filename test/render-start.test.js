const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('nouvel hébergeur : administrateur initial créé une seule fois, sans mot de passe affiché', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-render-'));
  Object.assign(process.env, { NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), CUTLY_MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64') });
  for (const key of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY', 'CUTLY_BOOTSTRAP_ADMIN_EMAIL']) delete process.env[key];
  const { db, databaseReady } = require('../server');
  const { ensureAdministrator } = require('../scripts/bootstrap-admin');
  try {
    await databaseReady;
    assert.equal(await ensureAdministrator(db, { email: '' }), false, 'rien sans e-mail');
    assert.equal(await ensureAdministrator(db, { email: 'Thomas@Example.org' }), true);
    assert.equal(await ensureAdministrator(db, { email: 'autre@example.org' }), false, 'une seule fois');
    const admin = await db.prepare("SELECT u.email,f.enabled FROM users u JOIN admin_mfa f ON f.user_id=u.id JOIN establishment_members m ON m.user_id=u.id WHERE u.role='ESTABLISHMENT_ADMIN'").get();
    assert.deepEqual({ ...admin }, { email: 'thomas@example.org', enabled: 1 });
  } finally {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
