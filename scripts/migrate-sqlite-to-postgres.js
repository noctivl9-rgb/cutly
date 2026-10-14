const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createDatabase, withTransaction } = require('../lib/database');

const TABLES = [
 'establishments', 'users', 'services', 'opening_hours', 'appointments', 'sessions', 'admin_mfa',
 'verification_challenges', 'establishment_members', 'unavailability', 'cancellation_requests',
 'payment_events', 'rewards', 'loyalty_ledger', 'reviews', 'audit_events', 'notification_outbox',
 'idempotency_keys', 'schema_migrations', 'rate_limits'
];

function getArg(name) {
 const index = process.argv.indexOf(name);
 return index < 0 ? null : process.argv[index + 1] || null;
}

function makeBackup(sourcePath, backupPath) {
 const source = path.resolve(sourcePath), destination = path.resolve(backupPath);
 if (source === destination) throw new Error('backup_must_not_replace_source');
 if (fs.existsSync(destination)) throw new Error('backup_already_exists');
 fs.mkdirSync(path.dirname(destination), { recursive: true });
 const database = new DatabaseSync(source);
 try {
  database.exec('PRAGMA busy_timeout=5000');
  database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
 } finally { database.close(); }
 const check = new DatabaseSync(destination, { readOnly: true });
 try {
  const integrity = check.prepare('PRAGMA integrity_check').get().integrity_check;
  const foreignKeys = check.prepare('PRAGMA foreign_key_check').all();
  if (integrity !== 'ok' || foreignKeys.length) throw new Error('backup_integrity_check_failed');
 } finally { check.close(); }
 return destination;
}

function inspectSource(sourcePath) {
 const source = new DatabaseSync(sourcePath, { readOnly: true });
 try {
  const integrity = source.prepare('PRAGMA integrity_check').get().integrity_check;
  if (integrity !== 'ok') throw new Error('source_integrity_check_failed');
  if (source.prepare('PRAGMA foreign_key_check').all().length) throw new Error('source_foreign_key_check_failed');
  const appointmentOverlap = source.prepare(`SELECT 1 FROM appointments a JOIN appointments b
   ON a.establishment_id=b.establishment_id AND a.id<b.id
   AND a.status IN ('PENDING','CONFIRMED') AND b.status IN ('PENDING','CONFIRMED')
   AND a.starts_at<b.ends_at AND a.ends_at>b.starts_at LIMIT 1`).get();
  if (appointmentOverlap) throw new Error('source_has_overlapping_active_appointments');
  const blockedAppointment = source.prepare(`SELECT 1 FROM appointments a JOIN unavailability u
   ON u.establishment_id=a.establishment_id AND a.status IN ('PENDING','CONFIRMED')
   AND a.starts_at<u.ends_at AND a.ends_at>u.starts_at LIMIT 1`).get();
  if (blockedAppointment) throw new Error('source_has_appointments_in_unavailability');
  const counts = new Map();
  for (const table of TABLES) counts.set(table, table==='rate_limits'&&!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rate_limits'").get()?0:source.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count);
  return { counts };
 } finally { source.close(); }
}

async function migrate({ sqlitePath, backupPath, databaseUrl }) {
 if (!sqlitePath || !fs.existsSync(sqlitePath)) throw new Error('sqlite_database_not_found');
 if (!backupPath) throw new Error('backup_path_required');
 if (!databaseUrl) throw new Error('CUTLY_DATABASE_URL_or_DATABASE_URL_required');

 // The backup is complete and independently verified before any target change.
 const verifiedBackup = makeBackup(sqlitePath, backupPath);
 const sourceDetails = inspectSource(verifiedBackup);
 const postgres = createDatabase({ url: databaseUrl });
 try {
  const existing = await postgres.prepare("SELECT COUNT(*) AS count FROM pg_tables WHERE schemaname='public'").get();
  if (Number(existing.count) !== 0) throw new Error('postgres_target_must_be_empty');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'postgres', 'schema.sql'), 'utf8');
  const source = new DatabaseSync(verifiedBackup, { readOnly: true });
  try {
   await withTransaction(postgres, async tx => {
    await tx.exec(schema);
    // The new schema's version rows are generated at setup time. Copying the
    // SQLite history preserves its original migration timestamps.
    await tx.prepare('DELETE FROM schema_migrations').run();
    for (const table of TABLES) {
     const columns = source.prepare(`PRAGMA table_info("${table}")`).all().map(column => column.name);
     if(table==='rate_limits'&&!columns.length)continue;
     if (!columns.length || columns.some(column => !/^[a-z][a-z0-9_]*$/i.test(column))) throw new Error(`invalid_source_table:${table}`);
     const rows = source.prepare(`SELECT * FROM "${table}"`).all();
     const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
     const insert = tx.prepare(`INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(',')}) VALUES(${placeholders})`);
     for (const row of rows) {
      const values = columns.map(column => table === 'appointments' && column === 'reward_id' ? null : row[column]);
      await insert.run(...values);
     }
    }
    const rewardLinks = source.prepare('SELECT id,reward_id FROM appointments WHERE reward_id IS NOT NULL').all();
    for (const link of rewardLinks) await tx.prepare('UPDATE appointments SET reward_id=? WHERE id=?').run(link.reward_id, link.id);
    for (const table of TABLES) {
     const actual = await tx.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get();
     if (Number(actual.count) !== Number(sourceDetails.counts.get(table))) throw new Error(`row_count_mismatch:${table}`);
     const canonical = rows => rows.map(row => JSON.stringify(Object.keys(row).sort().map(key => [key,row[key]]))).sort();
     const originalRows = canonical(table==='rate_limits'&&!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rate_limits'").get()?[]:source.prepare(`SELECT * FROM "${table}"`).all());
     const copiedRows = canonical(await tx.prepare(`SELECT * FROM "${table}"`).all());
     if (JSON.stringify(originalRows) !== JSON.stringify(copiedRows)) throw new Error(`row_content_mismatch:${table}`);
    }
   });
  } finally { source.close(); }
  return { backupPath: verifiedBackup, counts: Object.fromEntries(sourceDetails.counts) };
 } finally { await postgres.close(); }
}

if (require.main === module) {
 const sqlitePath = path.resolve(getArg('--sqlite') || process.env.CUTLY_DB_PATH || path.join(__dirname, '..', 'data', 'cutly.sqlite'));
 const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
 const backupPath = getArg('--backup') || path.join(path.dirname(sqlitePath), 'backups', `cutly-pre-postgres-${timestamp}.sqlite`);
 migrate({ sqlitePath, backupPath, databaseUrl: process.env.CUTLY_DATABASE_URL || process.env.DATABASE_URL || process.env.NETLIFY_DB_URL })
  .then(result => console.log(JSON.stringify({ migrated: true, backup: result.backupPath, rowCounts: result.counts }, null, 2)))
  .catch(error => { console.error('Migration stopped:', error.message); process.exitCode = 1; });
}

module.exports = { TABLES, makeBackup, inspectSource, migrate };
