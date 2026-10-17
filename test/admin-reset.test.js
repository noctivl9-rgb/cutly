const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('admin reset replaces password and TOTP secret, revokes sessions and audits the change', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-admin-reset-'));
  const mfaKey = crypto.randomBytes(32);
  Object.assign(process.env, {
    NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), CUTLY_MFA_ENCRYPTION_KEY: mfaKey.toString('base64'),
    CUTLY_BOOTSTRAP_ADMIN_EMAIL: 'thomas@example.org', CUTLY_BOOTSTRAP_ADMIN_PASSWORD: 'ancien-mot-de-passe-2026'
  });
  for (const key of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY']) delete process.env[key];
  const { db, databaseReady } = require('../server');
  const { verifyPassword, verifyAndConsumeTotp, totp, createSession } = require('../lib/auth');
  const { resetAdmin } = require('../scripts/reset-admin-netlify');
  try {
    await databaseReady;
    const originalLog = console.log; console.log = () => {};
    try { await require('../scripts/bootstrap-admin').main(); } finally { console.log = originalLog; }
    const admin = await db.prepare("SELECT id FROM users WHERE email='thomas@example.org'").get();
    await createSession(db, admin.id, 'test');

    const { secret } = await resetAdmin(db, { email: 'Thomas@Example.org', password: 'nouveau-mot-de-passe-2026', mfaKey });
    assert.match(secret, /^[A-Z2-7]{32}$/);
    const user = await db.prepare('SELECT password_hash FROM users WHERE id=?').get(admin.id);
    assert.equal(await verifyPassword('nouveau-mot-de-passe-2026', user.password_hash), true);
    assert.equal(await verifyPassword('ancien-mot-de-passe-2026', user.password_hash), false);
    const step = Math.floor(Date.now() / 30000);
    assert.equal(await verifyAndConsumeTotp(db, admin.id, totp(secret, step)), true, 'new secret accepted');
    const open = await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=? AND revoked_at IS NULL').get(admin.id);
    assert.equal(Number(open.n), 0, 'all sessions revoked');
    const audit = await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='ADMIN_CREDENTIALS_RESET' AND object_id=?").get(admin.id);
    assert.equal(Number(audit.n), 1);
    await assert.rejects(resetAdmin(db, { email: 'personne@example.org', password: 'x'.repeat(12), mfaKey }), /Aucun administrateur/);
  } finally {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
