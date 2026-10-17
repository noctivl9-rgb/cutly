const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { returnPath, initialize } = require('../public/legal-pages');
const publicPath = path.join(__dirname, '../public');
const pages = ['terms.html', 'privacy.html', 'legal.html', 'terms-of-use.html', 'cancellation.html'];

test('each legal document has readable content, a return link and valid legal navigation', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicPath, page), 'utf8');
    assert.match(html, /<html lang="fr">/);
    assert.match(html, /viewport-fit=cover/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    assert.ok((html.match(/<h2\b/g) || []).length >= 3);
    assert.match(html, /data-legal-back/);
    assert.match(html, /validation juridique requise/);
    assert.match(html, /src="\/legal-pages.js" defer/);
    for (const target of pages) assert.ok(html.includes(`href="/${target}"`), `${page} links to ${target}`);
    for (const [, anchor] of html.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(html.includes(`id="${anchor}"`), `${page} has real section ${anchor}`);
    }
    assert.doesNotMatch(html, /href="#"|href="javascript:/i);
  }
});

test('return navigation accepts known local pages and rejects injected or external destinations', () => {
  assert.equal(returnPath('?return=recap.html'), '/recap.html');
  assert.equal(returnPath('?return=%2Frecap.html'), '/recap.html');
  assert.equal(returnPath('?return=settings.html'), '/settings.html');
  for (const destination of ['https://example.com', '//example.com', 'javascript:alert(1)', '../admin.html', 'admin.html', '/recap.html?token=secret', '\\example.com']) {
    assert.equal(returnPath(`?return=${encodeURIComponent(destination)}`), '/');
  }
});

test('legal navigation carries the recap return destination across documents', () => {
  const back = {};
  const links = pages.map(page => ({ getAttribute: () => `/${page}` }));
  initialize({ querySelector: () => back, querySelectorAll: () => links }, { search: '?return=recap.html', origin: 'https://cutly.test' });
  assert.equal(back.href, '/recap.html');
  assert.equal(back.textContent, '← Retour au récapitulatif');
  for (let i = 0; i < links.length; i++) assert.equal(links[i].href, `/${pages[i]}?return=recap.html`);
});

test('loading a legal page does not read, clear or modify booking storage', () => {
  const untouchedStorage = new Proxy({}, { get() { assert.fail('Legal pages must leave booking storage untouched'); } });
  const back = {};
  vm.runInNewContext(fs.readFileSync(path.join(publicPath, 'legal-pages.js'), 'utf8'), {
    URL, URLSearchParams,
    localStorage: untouchedStorage, sessionStorage: untouchedStorage,
    window: { document: { querySelector: () => back, querySelectorAll: () => [] }, location: { search: '?return=recap.html', origin: 'https://cutly.test' }, localStorage: untouchedStorage, sessionStorage: untouchedStorage }
  });
  assert.equal(back.href, '/recap.html');
});
