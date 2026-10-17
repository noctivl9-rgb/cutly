const serverless = require('serverless-http');

// Netlify Database exposes its connection string through @netlify/database (Netlify.env or process.env).
// Resolve it before loading the server, which reads NETLIFY_DB_URL at start-up.
if (!process.env.NETLIFY_DB_URL && !process.env.CUTLY_DATABASE_URL && !process.env.DATABASE_URL) {
  try { process.env.NETLIFY_DB_URL = require('@netlify/database').getConnectionString(); }
  catch { console.error('CUTLY: Netlify Database connection string unavailable'); }
}

const { server, databaseReady, db } = require('../../server');
const { processOutbox } = require('../../lib/notifications');

const handleHttpRequest = serverless(server);

exports.handler = async (event, context) => {
  await databaseReady;
  const response = await handleHttpRequest(event, context);

  // Notification delivery is best-effort after the HTTP operation has already
  // completed. A provider/queue failure must never turn a stored booking into
  // an apparent booking failure. Scheduled reminders still need a suitable
  // always-on worker or a plan with enough database compute.
  try {
    await processOutbox(db, { limit: 5 });
  } catch {
    console.error('CUTLY notification dispatch failed');
  }

  return response;
};
