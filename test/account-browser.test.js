const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/account.js'), 'utf8');

function harness({ identity = false, search = '', fetch } = {}) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { disabled: false, hidden: true, textContent: '', dataset: {}, listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, querySelector() { return node(selector + '-child'); } });
    return nodes.get(selector);
  };
  const replacements = [];
  const context = { URL, URLSearchParams, setTimeout, fetch, window: {}, sessionStorage: { getItem() { return null; }, setItem() {} }, location: { origin: 'https://cutly.example', hash: '', search, assign() {}, replace() {} }, history: { replaceState(_state, _title, url) { replacements.push(url); } }, document: { querySelector(selector) { return selector === '#identity-page' && !identity ? null : node(selector); }, querySelectorAll() { return []; }, getElementById: node } };
  vm.runInNewContext(source, context);
  return { api: context.window.CutlyAccount, nodes, replacements };
}

test('account return URLs retain booking context but reject external or unapproved destinations', () => {
  const { api } = harness();
  assert.equal(api.safeReturn('/recap.html?service=taper'), '/recap.html?service=taper');
  assert.equal(api.safeReturn('https://evil.example/recap.html'), '/profile.html');
  assert.equal(api.safeReturn('//evil.example/profile.html'), '/profile.html');
  assert.equal(api.safeReturn('/admin.html'), '/profile.html');
});

test('account API never treats malformed successful responses as a completed action', async () => {
  const { api } = harness({ fetch: async () => ({ ok: true, json: async () => { throw Error('HTML received'); } }) });
  await assert.rejects(api.api('/api/client/profile'), /invalid_server_response/);
});

test('email verification check recovers its button after an asynchronous response', async () => {
  let resolve;
  const { nodes } = harness({ identity: true, search: '?mode=verify', fetch: () => new Promise(done => { resolve = done; }) });
  const button = nodes.get('#verification-check');
  const event = { currentTarget: button };
  const pending = button.listeners.click(event);
  assert.equal(button.disabled, true);
  // Browsers clear currentTarget after dispatch, before awaited network work finishes.
  event.currentTarget = null;
  resolve({ ok: true, json: async () => ({ emailVerifiedAt: null }) });
  await pending;
  assert.equal(button.disabled, false);
  assert.match(nodes.get('#verify-email-message').textContent, /pas encore vérifiée/);
});

test('password recovery removes the one-time token from the address bar before form submission', () => {
  const token = 'sensitive-recovery-token';
  const { replacements } = harness({ identity: true, search: `?resetPassword=${token}&return=recap.html` });
  assert.equal(replacements.length, 1);
  assert.equal(replacements[0].includes(token), false);
  assert.match(replacements[0], /return=%2Frecap.html/);
});
