// Réinitialise l'administrateur du site en ligne : nouveau mot de passe, nouvelle clé de double vérification,
// révocation de toutes ses sessions. Utile après une faute de frappe ou si la clé a été exposée.
// Les valeurs sensibles sont saisies de façon masquée et ne sont jamais enregistrées.
// Usage : npm run reset:admin:netlify
const crypto = require('node:crypto');
const { execSync } = require('node:child_process');
const readline = require('node:readline');
const { createDatabase, withTransaction } = require('../lib/database');
const { hashPassword, encodeBase32, encryptTotpSecret } = require('../lib/auth');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

async function main() {
  console.log('CUTLY — réinitialisation de l’administrateur du site en ligne (Netlify).\n');
  let key = '';
  try { key = execSync('netlify env:get CUTLY_MFA_ENCRYPTION_KEY --context production', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).pop().trim(); } catch {}
  const mfaKey = Buffer.from(key, 'base64');
  if (mfaKey.length !== 32) throw new Error('Clé CUTLY_MFA_ENCRYPTION_KEY introuvable sur Netlify (lancez la commande dans le dossier du projet relié à Netlify).');

  let url = process.env.CUTLY_DATABASE_URL || '';
  for (let attempt = 1; !url && attempt <= 3; attempt++) {
    url = await ask('Collez la chaîne de connexion « Read and write » (clic droit), puis Entrée — rien ne s’affiche : ', { hidden: true });
    if (!url) console.log('Aucune chaîne reçue. Recommencez : clic droit pour coller, puis Entrée.');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('La chaîne de connexion doit commencer par postgres:// ou postgresql://');
  console.log(`Chaîne reçue (${url.length} caractères).`);
  const email = (await ask('E-mail de l’administrateur : ')).toLowerCase();
  const password = await ask('Nouveau mot de passe (12 caractères minimum, masqué) : ', { hidden: true });
  if (password.length < 12) throw new Error('Le mot de passe doit contenir au moins 12 caractères.');
  if (password !== await ask('Confirmez le mot de passe (masqué) : ', { hidden: true })) throw new Error('Les deux mots de passe ne correspondent pas.');

  const db = createDatabase({ url });
  try {
    const { secret } = await resetAdmin(db, { email, password, mfaKey });
    console.log(`
Administrateur réinitialisé. Nouvelle clé pour Google Authenticator (affichée une seule fois) : ${secret}`);
    console.log('Supprimez l’ancien compte « CUTLY en ligne » dans l’application, ajoutez cette nouvelle clé, puis connectez-vous sur https://cutlyt.netlify.app/admin.html');
  } finally { await db.close(); }
}

// Nouveau mot de passe + nouvelle clé TOTP, sessions révoquées, événement d'audit. Renvoie la clé en clair (à afficher une fois).
async function resetAdmin(db, { email, password, mfaKey, now = new Date() }) {
  const secret = encodeBase32(crypto.randomBytes(20)), timestamp = now.toISOString(), passwordHash = await hashPassword(password);
  await withTransaction(db, async tx => {
    const user = await tx.prepare("SELECT id FROM users WHERE lower(email)=? AND role='ESTABLISHMENT_ADMIN' AND disabled_at IS NULL").get(String(email).toLowerCase());
    if (!user) throw new Error('Aucun administrateur actif avec cet e-mail.');
    await tx.prepare('UPDATE users SET password_hash=?,updated_at=?,version=version+1 WHERE id=?').run(passwordHash, timestamp, user.id);
    await tx.prepare('UPDATE admin_mfa SET secret_encrypted=?,enabled=1,last_used_step=-1 WHERE user_id=?').run(encryptTotpSecret(secret, mfaKey), user.id);
    await tx.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(timestamp, user.id);
    await tx.prepare("INSERT INTO audit_events(id,actor_id,action,object_type,object_id,result,created_at) VALUES(?,?,'ADMIN_CREDENTIALS_RESET','USER',?,'SUCCESS',?)").run(crypto.randomUUID(), user.id, user.id, timestamp);
  });
  return { secret };
}

if (require.main === module) main().catch(error => { console.error(`Échec : ${error.message}`); process.exitCode = 1; });
module.exports = { resetAdmin };
