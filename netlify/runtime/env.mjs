// Variables d'environnement visibles par le serveur CUTLY (CommonJS) dans les fonctions Netlify.
// Netlify Database n'injecte NETLIFY_DB_URL que dans les fonctions au format v2 : on la recopie dans process.env.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function loadCutlyEnv() {
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
