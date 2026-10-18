const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('diagnostic de connexion : identifie le mot de passe, la clé et l’heure du téléphone sans rien modifier', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-admin-check-'));
  const mfaKey = crypto.randomBytes(32);
  Object.assign(process.env, { NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), CUTLY_MFA_ENCRYPTION_KEY: mfaKey.toString('base64'), CUTLY_BOOTSTRAP_ADMIN_EMAIL: 'thomas@example.org', CUTLY_BOOTSTRAP_ADMIN_PASSWORD: 'mot-de-passe-correct-2030' });
  for (const key of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY']) delete process.env[key];
  const { db, databaseReady } = require('../server');
  const { totp, decryptTotpSecret } = require('../lib/auth');
  const { diagnose } = require('../scripts/check-admin-netlify');
  try {
    await databaseReady;
    const originalLog = console.log; console.log = () => {};
    try { await require('../scripts/bootstrap-admin').main(); } finally { console.log = originalLog; }
    const admin = await db.prepare("SELECT id FROM users WHERE email='thomas@example.org'").get();
    const secret = decryptTotpSecret((await db.prepare('SELECT secret_encrypted FROM admin_mfa WHERE user_id=?').get(admin.id)).secret_encrypted, mfaKey);
    const now = new Date(), step = Math.floor(now.getTime() / 30000);
    const base = { email: 'THOMAS@example.org', password: 'mot-de-passe-correct-2030', code: totp(secret, step), mfaKey, now };
    assert.equal((await diagnose(db, base)).ok, true);
    const wrongPassword = await diagnose(db, { ...base, password: 'autre-mot-de-passe-2030' });
    assert.deepEqual([wrongPassword.password.ok, wrongPassword.code.ok], [false, true], 'seul le mot de passe est signalé');
    const wrongKey = await diagnose(db, { ...base, code: totp('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', step) });
    assert.equal(wrongKey.code.ok, false);
    assert.match(wrongKey.code.message, /n’est pas la bonne/);
    const skewed = await diagnose(db, { ...base, code: totp(secret, step - 6) });
    assert.equal(skewed.code.ok, false);
    assert.match(skewed.code.message, /bon, mais l’heure de votre téléphone/);
    assert.equal((await diagnose(db, { ...base, email: 'inconnu@example.org' })).account.ok, false);
    assert.equal((await diagnose(db, { ...base, mfaKey: crypto.randomBytes(32) })).mfa.ok, false, 'clé de chiffrement différente');
    // Lecture seule : un même code reste utilisable pour la vraie connexion.
    assert.equal((await db.prepare('SELECT last_used_step FROM admin_mfa WHERE user_id=?').get(admin.id)).last_used_step, -1);
  } finally {
    await db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
