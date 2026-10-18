// Diagnostic de l'administrateur en ligne : dit lequel des éléments de connexion est faux (e-mail, mot de passe, clé, heure du téléphone).
// Lecture seule : ne modifie rien, ne consomme aucun code. Les valeurs sont saisies de façon masquée et jamais enregistrées.
// Usage : npm run check:admin:netlify
const { execSync } = require('node:child_process');
const readline = require('node:readline');
const { createDatabase } = require('../lib/database');
const { verifyPassword, decryptTotpSecret, totp } = require('../lib/auth');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

// Renvoie un rapport : { account, password, mfa, code } avec un état et un message pour chaque élément.
async function diagnose(db, { email, password, code, mfaKey, now = new Date(), windowSteps = 10 }) {
  const report = { account: null, password: null, mfa: null, code: null, ok: false };
  const user = await db.prepare("SELECT id,email,role,password_hash,disabled_at FROM users WHERE lower(email)=lower(?)").get(String(email).trim());
  if (!user) { report.account = { ok: false, message: 'Aucun compte avec cet e-mail.' }; return report; }
  if (user.role !== 'ESTABLISHMENT_ADMIN') { report.account = { ok: false, message: 'Ce compte existe mais n’est pas un compte administrateur.' }; return report; }
  if (user.disabled_at) { report.account = { ok: false, message: 'Ce compte administrateur est désactivé.' }; return report; }
  const member = await db.prepare("SELECT 1 FROM establishment_members WHERE user_id=? AND establishment_id='thomas-shop' AND role='ESTABLISHMENT_ADMIN' AND active=1").get(user.id);
  report.account = member ? { ok: true, message: 'Compte administrateur actif.' } : { ok: false, message: 'Compte trouvé mais non rattaché à Thomas Shop.' };

  report.password = await verifyPassword(String(password), user.password_hash)
    ? { ok: true, message: 'Mot de passe correct.' }
    : { ok: false, message: 'Mot de passe INCORRECT : celui saisi ne correspond pas à celui enregistré.' };

  const record = await db.prepare('SELECT secret_encrypted,enabled FROM admin_mfa WHERE user_id=?').get(user.id);
  if (!record || record.enabled !== 1) { report.mfa = { ok: false, message: 'La double vérification n’est pas activée pour ce compte.' }; return report; }
  let secret;
  try { secret = decryptTotpSecret(record.secret_encrypted, mfaKey); }
  catch { report.mfa = { ok: false, message: 'La clé de chiffrement de production ne déchiffre pas la double vérification : elle diffère de celle utilisée à la création.' }; return report; }
  report.mfa = { ok: true, message: 'Double vérification activée et lisible.' };

  if (!/^\d{6}$/.test(String(code))) { report.code = { ok: false, message: 'Le code doit contenir exactement 6 chiffres.' }; return report; }
  const current = Math.floor(now.getTime() / 30000);
  let offset = null;
  for (let delta = 0; delta <= windowSteps && offset === null; delta++) for (const sign of delta ? [-1, 1] : [1]) if (totp(secret, current + sign * delta) === String(code)) { offset = sign * delta; break; }
  if (offset === null) report.code = { ok: false, message: 'Code INCORRECT : il ne correspond à aucune valeur attendue dans les 5 minutes autour de maintenant. La clé saisie dans Google Authenticator n’est pas la bonne (ou c’est un ancien compte).' };
  else if (Math.abs(offset) <= 1) report.code = { ok: true, message: 'Code correct.' };
  else report.code = { ok: false, offset, message: `Le code est le bon, mais l’heure de votre téléphone est décalée d’environ ${Math.abs(offset) * 30} secondes ${offset < 0 ? 'de retard' : 'd’avance'} : réglez la date et l’heure en AUTOMATIQUE.` };
  report.ok = report.account.ok && report.password.ok && report.mfa.ok && report.code.ok;
  return report;
}

async function main() {
  console.log('CUTLY — diagnostic de l’administrateur en ligne (lecture seule).\n');
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
  console.log(`Chaîne reçue (${url.length} caractères).\n`);
  const email = await ask('E-mail de l’administrateur : ');
  const password = await ask('Mot de passe (masqué) : ', { hidden: true });
  const code = await ask('Code à 6 chiffres affiché MAINTENANT dans Google Authenticator : ');
  const db = createDatabase({ url });
  try {
    const report = await diagnose(db, { email, password, code, mfaKey });
    console.log('\n--- Résultat ---');
    for (const [label, item] of [['Compte', report.account], ['Mot de passe', report.password], ['Double vérification', report.mfa], ['Code', report.code]]) if (item) console.log(`${item.ok ? '[OK]    ' : '[ERREUR]'} ${label} : ${item.message}`);
    console.log(report.ok ? '\nTout est correct : vous pouvez vous connecter sur https://cutlyt.netlify.app/admin.html avec ces mêmes valeurs.' : '\nCorrigez l’élément marqué [ERREUR], puis relancez ce diagnostic.');
  } finally { await db.close(); }
}

if (require.main === module) main().catch(error => { console.error(`Échec : ${error.message}`); process.exitCode = 1; });
module.exports = { diagnose };
