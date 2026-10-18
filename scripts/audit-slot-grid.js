// Read-only audit: never loads server.js, runs migrations or changes reservations.
// PostgreSQL: node --env-file-if-exists=.env.local scripts/audit-slot-grid.js --postgres
// SQLite: node scripts/audit-slot-grid.js --sqlite path/to/cutly.sqlite
const { SLOT_INTERVAL_MINUTES } = require('../lib/slot-policy');
const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function summarize(rows) {
 const result = { timezone: 'Europe/Paris', startIntervalMinutes: SLOT_INTERVAL_MINUTES, inspected: rows.length, nonconforming: 0, byStatus: {}, invalidInstants: 0 };
 for (const row of rows) {
  const date = new Date(row.starts_at);
  if (!Number.isFinite(date.getTime())) { result.invalidInstants++; continue; }
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  if (Number(parts.minute) % SLOT_INTERVAL_MINUTES || Number(parts.second) || date.getUTCMilliseconds()) {
   result.nonconforming++;
   result.byStatus[row.status] = (result.byStatus[row.status] || 0) + 1;
  }
 }
 return result;
}

async function main() {
 const [mode, filename] = process.argv.slice(2);
 let rows;
 if (mode === '--sqlite' && filename) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true });
  try { rows = db.prepare('SELECT starts_at,status FROM appointments').all(); }
  finally { db.close(); }
 } else if (mode === '--postgres') {
  const connectionString = process.env.CUTLY_DATABASE_URL || process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_MISSING');
  const { Client } = require('pg');
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
  try {
   await client.connect();
   await client.query('BEGIN READ ONLY');
   await client.query("SET LOCAL statement_timeout = '15s'");
   rows = (await client.query('SELECT starts_at,status FROM appointments')).rows;
   await client.query('ROLLBACK');
  } finally { await client.end(); }
 } else throw new Error('USAGE: --postgres OR --sqlite path');
 // Counts only: no appointment identifiers, customer details or connection secrets.
 console.log(JSON.stringify(summarize(rows), null, 2));
}
if (require.main === module) main().catch(() => { console.error('Audit failed. Check database access and schema; no data was changed.'); process.exitCode = 1; });
module.exports = { summarize };
