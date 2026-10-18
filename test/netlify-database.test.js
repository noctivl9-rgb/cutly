const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'db/postgres/schema.sql'), 'utf8');
const migrationsDir = path.join(root, 'netlify/database/migrations');

test('Netlify Database migration carries the full PostgreSQL schema and Thomas Shop reference data', () => {
  const files = fs.readdirSync(migrationsDir);
  for (const file of files) assert.match(file, /^\d+_[a-z0-9_-]+\.sql$/, `${file} follows <number>_<slug>.sql`);
  const migration = fs.readFileSync(path.join(migrationsDir, '0001_cutly_initial_schema.sql'), 'utf8');
  assert.ok(migration.includes(schema), 'migration embeds db/postgres/schema.sql unchanged');
  for (const id of ['degrade-classique', 'burst-fade', 'taper', 'coupe-classique', 'contours']) assert.ok(migration.includes(`'${id}'`), `seeds ${id}`);
  assert.match(migration, /INSERT INTO establishments[\s\S]*'thomas-shop'/);
  assert.match(migration, /INSERT INTO opening_hours[\s\S]*\('thomas-shop',6,'09:00','19:00'\)/);
});

test('server applies PostgreSQL updates in order and the Netlify migrations mirror them', () => {
  const versions = [...schema.matchAll(/\((\d+),'[a-z-]+'\)/g)].map(match => Number(match[1]));
  assert.equal(Math.max(...versions), 7, 'schema.sql stays at version 7; later changes are updates');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const updateDir = path.join(root, 'db/postgres/updates');
  let latest = 7;
  for (const file of fs.readdirSync(updateDir).sort()) {
    const sql = fs.readFileSync(path.join(updateDir, file), 'utf8');
    const version = Number(sql.match(/VALUES \((\d+),/)[1]);
    assert.ok(version > latest, `${file} follows the previous version`);
    latest = version;
    assert.ok(server.includes(`[${version},'db/postgres/updates/${file}']`), `server applies ${file}`);
    assert.equal(fs.readFileSync(path.join(migrationsDir, file), 'utf8'), sql, `Netlify migration ${file} is identical`);
  }
  assert.equal(Number(server.match(/const POSTGRES_SCHEMA_VERSION=(\d+);/)[1]), latest);
});

test('test runner strips hosted database and Netlify production variables', () => {
  const runner = fs.readFileSync(path.join(root, 'scripts/run-tests.js'), 'utf8');
  for (const key of ['NETLIFY_DB_URL', 'CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY']) assert.ok(runner.includes(`'${key}'`), `${key} removed`);
});
