// Variables d'environnement visibles par le serveur CUTLY dans les fonctions Netlify (format v2).
// Netlify Database n'injecte NETLIFY_DB_URL que dans ce format : on la recopie dans process.env.
// IMPORTANT : ce fichier est chargé par require() depuis netlify/functions/*.mjs, comme server.js. Les fonctions ne doivent
// importer (import …) que des modules « node: » : un import relatif change le mode d'empaquetage de Netlify et
// server.js n'est alors plus embarqué (erreur 502 « Cannot find module »). Voir test/netlify-function.test.js.
function loadCutlyEnv() {
  const netlifyEnv = globalThis.Netlify?.env;
  for (const key of ['NETLIFY_DB_URL', 'CUTLY_MFA_ENCRYPTION_KEY', 'CUTLY_PUBLIC_BASE_URL', 'CUTLY_EMAIL_FROM', 'CUTLY_EMAIL_REPLY_TO', 'CUTLY_JOB_TOKEN', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET']) {
    const value = netlifyEnv?.get?.(key);
    if (value && !process.env[key]) process.env[key] = value;
  }
  if (!process.env.NETLIFY_DB_URL && !process.env.CUTLY_DATABASE_URL) {
    try { process.env.NETLIFY_DB_URL = require('@netlify/database').getConnectionString(); }
    catch { console.error('CUTLY: Netlify Database connection string unavailable'); }
  }
  process.env.CUTLY_BEHIND_FUNCTION_PROXY = '1';
}

module.exports = { loadCutlyEnv };
