// Crée le premier administrateur dans la base Netlify Database du site en ligne.
// Les valeurs sensibles sont saisies de façon masquée et ne sont jamais affichées ni enregistrées.
// Usage : npm run bootstrap:admin:netlify
const { execSync } = require('node:child_process');
const readline = require('node:readline');

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

async function main() {
  console.log('CUTLY — création de l’administrateur du site en ligne (Netlify).');
  console.log('Copiez la chaîne de connexion de la branche « production » dans Netlify : Data & Storage > Database.\n');

  let key;
  try {
    key = execSync('netlify env:get CUTLY_MFA_ENCRYPTION_KEY --context production', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split(/\r?\n/).pop().trim();
  } catch { key = ''; }
  if (Buffer.from(key, 'base64').length !== 32) throw new Error('Clé CUTLY_MFA_ENCRYPTION_KEY introuvable sur Netlify (exécutez la commande dans le dossier du projet relié à Netlify).');

  const url = await ask('Chaîne de connexion (masquée) : ', { hidden: true });
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error('La chaîne de connexion doit commencer par postgres:// ou postgresql://');
  const email = await ask('E-mail de l’administrateur : ');
  const password = await ask('Mot de passe (12 caractères minimum, masqué) : ', { hidden: true });
  const confirmation = await ask('Confirmez le mot de passe (masqué) : ', { hidden: true });
  if (password !== confirmation) throw new Error('Les deux mots de passe ne correspondent pas.');

  Object.assign(process.env, {
    NODE_ENV: 'production',
    CUTLY_DATABASE_URL: url,
    CUTLY_MFA_ENCRYPTION_KEY: key,
    CUTLY_BOOTSTRAP_ADMIN_EMAIL: email,
    CUTLY_BOOTSTRAP_ADMIN_PASSWORD: password
  });
  await require('./bootstrap-admin').main();
  console.log('\nConnectez-vous ensuite sur https://cutlyt.netlify.app/admin.html avec cet e-mail, ce mot de passe et le code à 6 chiffres.');
}

main().catch(error => { console.error(`Échec : ${error.message}`); process.exitCode = 1; });
