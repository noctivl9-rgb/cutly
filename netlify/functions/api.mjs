// Fonction Netlify (format v2) : Netlify Database n'injecte NETLIFY_DB_URL que dans ce format.
// Le serveur HTTP de CUTLY tourne tel quel dans la fonction ; chaque requête lui est relayée en local.
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const netlifyEnv = globalThis.Netlify?.env;

// Variables du site (et de la base) visibles par le serveur CommonJS qui lit process.env.
for (const key of ['NETLIFY_DB_URL', 'CUTLY_MFA_ENCRYPTION_KEY', 'CUTLY_PUBLIC_BASE_URL', 'CUTLY_EMAIL_FROM', 'CUTLY_JOB_TOKEN', 'RESEND_API_KEY']) {
  const value = netlifyEnv?.get?.(key);
  if (value && !process.env[key]) process.env[key] = value;
}
if (!process.env.NETLIFY_DB_URL && !process.env.CUTLY_DATABASE_URL) {
  try { process.env.NETLIFY_DB_URL = require('@netlify/database').getConnectionString(); }
  catch { console.error('CUTLY: Netlify Database connection string unavailable'); }
}
process.env.CUTLY_BEHIND_FUNCTION_PROXY = '1';

const { server, databaseReady, db } = require('../../server.js');
const { processOutbox } = require('../../lib/notifications.js');

let listening;
function listen() {
  listening ??= databaseReady.then(() => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  }));
  return listening;
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);

export default async (request, context) => {
  const port = await listen();
  const url = new URL(request.url);
  const body = ['GET', 'HEAD'].includes(request.method) ? null : Buffer.from(await request.arrayBuffer());
  const headers = {};
  for (const [key, value] of request.headers) if (!HOP_BY_HOP.has(key) && key !== 'x-cutly-client-ip') headers[key] = value;
  headers.host = url.host;
  headers['x-cutly-client-ip'] = context?.ip || 'unknown';
  if (body) headers['content-length'] = String(body.length);

  const upstream = await new Promise((resolve, reject) => {
    const proxied = http.request({ host: '127.0.0.1', port, method: request.method, path: url.pathname + url.search, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    proxied.on('error', reject);
    if (body) proxied.write(body);
    proxied.end();
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(upstream.headers)) {
    if (HOP_BY_HOP.has(key) || value == null) continue;
    if (Array.isArray(value)) value.forEach(item => responseHeaders.append(key, item)); else responseHeaders.set(key, String(value));
  }

  // Envoi des notifications après la réponse : un échec d'envoi ne change jamais une réservation enregistrée.
  const dispatch = processOutbox(db, { limit: 5 }).catch(() => console.error('CUTLY notification dispatch failed'));
  if (typeof context?.waitUntil === 'function') context.waitUntil(dispatch); else await dispatch;

  const empty = request.method === 'HEAD' || upstream.status === 204 || upstream.status === 304;
  return new Response(empty ? null : upstream.body, { status: upstream.status, headers: responseHeaders });
};

export const config = { path: ['/api/*', '/healthz'] };
