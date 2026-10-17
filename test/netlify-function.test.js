const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('Netlify v2 function relays health, status and shop routes to the CUTLY server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-netlify-'));
  const functionUrl = pathToFileURL(path.join(__dirname, '..', 'netlify', 'functions', 'api.mjs')).href;
  const script = `
    (async () => {
      const { default: handler, config } = await import(${JSON.stringify(functionUrl)});
      if (!config.path.includes('/api/*') || !config.path.includes('/healthz')) throw new Error('routes_missing');
      const context = { ip: '203.0.113.7', waitUntil: () => {} };
      const call = (route, init) => handler(new Request('https://cutly.test' + route, init), context);
      const health = await call('/healthz');
      const status = await call('/api/status');
      const shop = await call('/api/shop');
      if (health.status !== 200 || (await health.json()).status !== 'ok') throw new Error('health_route_failed');
      const statusBody = await status.json();
      if (status.status !== 200 || statusBody.database !== 'SQLITE') throw new Error('status_route_failed:' + status.status);
      const shopBody = await shop.json();
      if (shop.status !== 200 || shopBody.services.length !== 5) throw new Error('shop_route_failed:' + shop.status);
      if (!shop.headers.get('content-security-policy')) throw new Error('security_headers_lost');
      const login = await call('/api/auth/client/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://cutly.test' }, body: JSON.stringify({ email: 'nobody@example.org', password: 'x' }) });
      if (login.status !== 401 && login.status !== 400) throw new Error('post_route_failed:' + login.status);
      process.stdout.write('netlify-function-ok');
      process.exit(0);
    })().catch(error => { console.error(error); process.exit(1); });
  `;
  const env = { ...process.env, NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), PORT: '0', CUTLY_HOST: '127.0.0.1' };
  for (const key of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY']) delete env[key];
  try {
    const output = execFileSync(process.execPath, ['--input-type=commonjs', '-e', script], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
    assert.equal(output, 'netlify-function-ok');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('rate limiting trusts the forwarded visitor address only behind the local function relay', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /process\.env\.CUTLY_BEHIND_FUNCTION_PROXY==='1'&&\(local==='127\.0\.0\.1'/);
  const relay = fs.readFileSync(path.join(__dirname, '..', 'netlify', 'functions', 'api.mjs'), 'utf8');
  assert.match(relay, /key !== 'x-cutly-client-ip'/, 'client-supplied forwarding header is discarded');
});
