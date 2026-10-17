// Runs the test suite in isolation: never against a hosted database or in Netlify production mode.
// Netlify injects NETLIFY_DB_URL (and NETLIFY=true) into builds, which would otherwise reach the live database.
const { spawnSync } = require('node:child_process');

const env = { ...process.env };
for (const key of ['NETLIFY_DB_URL', 'CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY']) delete env[key];
env.NODE_ENV = 'test';

const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit', env });
process.exitCode = result.status ?? 1;
