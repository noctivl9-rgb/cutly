const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('Netlify function serves health and status routes without starting a listener', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-netlify-'));
  const databasePath = path.join(tempDir, 'cutly.sqlite');
  const functionPath = path.join(__dirname, '..', 'netlify', 'functions', 'api.js');
  const script = `
    (async () => {
      const { handler } = require(${JSON.stringify(functionPath)});
      const call = path => handler({
        httpMethod: 'GET', path, headers: { host: 'localhost' },
        queryStringParameters: null, multiValueQueryStringParameters: null,
        body: null, isBase64Encoded: false
      }, {});
      const health = await call('/healthz');
      const status = await call('/api/status');
      if (health.statusCode !== 200 || JSON.parse(health.body).status !== 'ok') throw new Error('health_route_failed');
      if (status.statusCode !== 200 || JSON.parse(status.body).database !== 'SQLITE') throw new Error('status_route_failed:' + status.statusCode + ':' + status.body);
      process.stdout.write('netlify-function-ok');
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  const env = { ...process.env, NODE_ENV: 'test', CUTLY_DB_PATH: databasePath, PORT: '0', CUTLY_HOST: '127.0.0.1' };
  delete env.CUTLY_DATABASE_URL;
  delete env.NETLIFY_DB_URL;
  try {
    const output = execFileSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(output, 'netlify-function-ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
