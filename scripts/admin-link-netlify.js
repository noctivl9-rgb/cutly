// Crée un lien privé de connexion à l'administration du site en ligne, valable 24 h (réutilisable pendant ce temps).
// Le lien précédent est révoqué. « --revoquer » révoque tous les liens sans en créer.
// Usage : npm run admin:link   (ou double-clic sur lien-admin-en-ligne.bat)
const { execSync } = require('node:child_process');
const readline = require('node:readline');
const { createDatabase } = require('../lib/database');
const { createAdminLink, revokeAdminLinks } = require('../lib/admin-links');

const SITE = 'https://cutlyt.netlify.app';

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

async function main() {
  const revoke = process.argv.includes('--revoquer');
  let key = '';
  try { key = execSync('netlify env:get CUTLY_MFA_ENCRYPTION_KEY --context production', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).pop().trim(); } catch {}
  const secretKey = Buffer.from(key, 'base64');
  if (secretKey.length !== 32) throw new Error('Clé CUTLY_MFA_ENCRYPTION_KEY introuvable sur Netlify (lancez la commande dans le dossier du projet relié à Netlify).');
  let url = process.env.CUTLY_DATABASE_URL || '';
  for (let attempt = 1; !url && attempt <= 3; attempt++) {
    url = await ask('Collez la chaîne de connexion « Read and write » (clic droit), puis Entrée — rien ne s’affiche : ', { hidden: true });
    if (!url) console.log('Aucune chaîne reçue. Recommencez : clic droit pour coller, puis Entrée.');
  }
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('La chaîne de connexion doit commencer par postgres:// ou postgresql://');
  console.log(`Chaîne reçue (${url.length} caractères).\n`);
  const email = (await ask('E-mail de l’administrateur (Entrée = eliasfth25@gmail.com) : ')) || 'eliasfth25@gmail.com';
  const db = createDatabase({ url });
  try {
    if (revoke) { console.log(`\n${await revokeAdminLinks(db, { email })} lien(s) révoqué(s).`); return; }
    const { token, expiresAt } = await createAdminLink(db, { email, key: secretKey });
    const until = new Date(expiresAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
    console.log('\n=== VOTRE LIEN PRIVÉ (ne le partagez avec personne) ===\n');
    console.log(`${SITE}/admin-lien.html#lien=${token}`);
    console.log(`\nValable jusqu’au ${until}. Il remplace votre mot de passe et votre code : gardez-le pour vous.`);
    console.log('Pour un nouveau lien, relancez cette commande (l’ancien cessera de fonctionner).');
  } finally { await db.close(); }
}

main().catch(error => { console.error(`Échec : ${error.message}`); process.exitCode = 1; });
