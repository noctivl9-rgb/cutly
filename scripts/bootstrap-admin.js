const crypto = require('node:crypto');
const path = require('node:path');
const { createDatabase, withTransaction } = require('../lib/database');
const { hashPassword, encodeBase32, encryptTotpSecret, mfaKey } = require('../lib/auth');

async function main() {
 const email = process.env.CUTLY_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
 const password = process.env.CUTLY_BOOTSTRAP_ADMIN_PASSWORD;
 const key = mfaKey();
 if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Set a valid CUTLY_BOOTSTRAP_ADMIN_EMAIL.');
 if (process.env.NODE_ENV === 'production' && /(?:@(?:localhost|cutly\.local|example\.(?:com|net|org))$|\.(?:local|test|invalid)$)/i.test(email)) throw new Error('Production bootstrap refuses a local or reserved demo email address.');
 if (!password || password.length < 12) throw new Error('Set CUTLY_BOOTSTRAP_ADMIN_PASSWORD to at least 12 characters.');
 if (!key) throw new Error('Set CUTLY_MFA_ENCRYPTION_KEY to a base64-encoded 32-byte key.');
 const db = createDatabase({ url: process.env.CUTLY_DATABASE_URL || process.env.DATABASE_URL || process.env.NETLIFY_DB_URL, sqlitePath: process.env.CUTLY_DB_PATH || path.join(__dirname, '..', 'data', 'cutly.sqlite') });
 try {
  const tables = db.kind === 'POSTGRES'
   ? await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'").all()
   : db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = new Set(tables.map(row => row.name));
  for (const name of ['users', 'establishments', 'establishment_members', 'admin_mfa']) if (!names.has(name)) throw new Error('Start CUTLY once to initialize its database, then run this bootstrap command.');
  const id = crypto.randomUUID(), now = new Date().toISOString(), secret = encodeBase32(crypto.randomBytes(20)), passwordHash = await hashPassword(password);
  await withTransaction(db, async tx => {
   await tx.lock?.('first-administrator-bootstrap');
   if (await tx.prepare("SELECT 1 FROM users WHERE role IN ('ESTABLISHMENT_ADMIN','PLATFORM_ADMIN') LIMIT 1").get()) throw new Error('An administrator already exists; bootstrap is one-time only.');
   if (!await tx.prepare("SELECT 1 FROM establishments WHERE id='thomas-shop'").get()) throw new Error('Thomas Shop is not initialized.');
   await tx.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES(?,?, 'Thomas','Shop',?,'ESTABLISHMENT_ADMIN',?,?)`).run(id, email, passwordHash, now, now);
   await tx.prepare("INSERT INTO establishment_members(user_id,establishment_id,role,active) VALUES(?,'thomas-shop','ESTABLISHMENT_ADMIN',1)").run(id);
   await tx.prepare('INSERT INTO admin_mfa(user_id,secret_encrypted,enabled,last_used_step,created_at) VALUES(?,?,1,-1,?)').run(id, encryptTotpSecret(secret, key), now);
  });
  console.log(`Administrator created for ${email}. Add the one-time TOTP secret to an authenticator now: ${secret}`);
  console.log('The secret is shown once. Keep CUTLY_MFA_ENCRYPTION_KEY stable and private.');
 } finally { await db.close(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { main };
