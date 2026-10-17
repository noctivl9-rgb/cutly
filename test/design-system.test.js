const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicPath = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(publicPath, file), 'utf8');
const clientPages = ['index.html', 'services.html', 'shop.html', 'booking.html', 'calendar.html', 'slots.html', 'recap.html', 'confirmation.html',
  'appointments.html', 'appointment.html', 'history.html', 'account.html', 'profile.html', 'settings.html', 'loyalty.html',
  'terms.html', 'privacy.html', 'legal.html', 'terms-of-use.html', 'cancellation.html', 'install.html'];

test('every client page shares the CUTLY brand, stylesheet and four-tab iPhone navigation', () => {
  for (const page of clientPages) {
    const html = read(page);
    assert.match(html, /href="\/mobile-app\.css"/, `${page} uses the design system`);
    assert.match(html, /class="brand-mark"/, `${page} shows the CUTLY mark`);
    const navs = html.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/g) || [];
    assert.equal(navs.length, 1, `${page} has one bottom navigation`);
    const targets = [...navs[0].matchAll(/<a href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(targets, ['/', '/booking.html', '/appointments.html', '/profile.html'], `${page} tab order`);
    assert.ok((navs[0].match(/aria-current="page"/g) || []).length <= 1, `${page} has at most one active tab`);
  }
});

test('client pages only link to pages that exist and never use inline styles blocked by the CSP', () => {
  for (const page of clientPages) {
    const html = read(page);
    assert.doesNotMatch(html, /\sstyle="/, `${page} has no inline style attribute`);
    for (const [, target] of html.matchAll(/href="\/([a-z-]+\.(?:html|css|svg|webmanifest))(?:[?#][^"]*)?"/g)) {
      assert.ok(fs.existsSync(path.join(publicPath, target)), `${page} links to existing ${target}`);
    }
  }
});

test('slot page explains the four slot states and the script renders every server entry, not only free ones', () => {
  const slots = read('slots.html');
  for (const label of ['Disponible', 'Occupé', 'Indisponible', 'Sélectionné']) assert.match(slots, new RegExp(`</i>${label}</span>`));
  assert.match(slots, /<h1 class="page-title">À quelle heure \?<\/h1>/);
  const app = read('app.js');
  assert.match(app, /for\(const entry of data\.entries\)/);
  assert.match(app, /button\.disabled=!available;button\.dataset\.status=entry\.status/);
  const css = read('mobile-app.css');
  for (const state of ['OCCUPIED', 'UNAVAILABLE', 'PAST']) assert.match(css, new RegExp(`\\.time-slot\\[data-status=${state}\\]`));
  assert.match(css, /\.time-slot\[aria-pressed=true\]/);
});

test('booking steps keep a visible back link and step caption, and the home page leads with booking', () => {
  for (const [page, step] of [['booking.html', 1], ['calendar.html', 2], ['slots.html', 3], ['recap.html', 5]]) {
    const html = read(page);
    assert.match(html, /class="back-link"/, `${page} back link`);
    assert.match(html, new RegExp(`Étape ${step} sur 5`), `${page} step caption`);
  }
  const home = read('index.html');
  const primary = home.indexOf('Réserver une coupe'), secondary = home.indexOf('Mes rendez-vous');
  assert.ok(primary > 0 && primary < secondary, 'Réserver une coupe is the first action');
  assert.doesNotMatch(home.slice(0, primary), /Appeler/);
});

test('home hero follows the provided spec: pill navbar, booking CTA, typing timings and motion curves', () => {
  const home = read('index.html');
  assert.match(home, /<a class="hero-logo font-instrument" href="\/"[^>]*>CUTLY<\/a>/);
  assert.match(home, /<a class="hero-cta group" href="\/booking\.html">[\s\S]*?Réserver une coupe/);
  const links = [...home.match(/<div class="hero-links">([\s\S]*?)<\/div>/)[1].matchAll(/href="\/([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(links, ['services.html', 'shop.html', 'appointments.html', 'loyalty.html']);
  for (const target of links) assert.ok(fs.existsSync(path.join(publicPath, target)));
  assert.match(home, /data-typing-messages/);
  const script = read('home-hero.js');
  assert.match(script, /TYPING = 100, DELETING = 50, PAUSE = 2000/);
  const css = read('home-hero.css');
  assert.match(css, /--hero-ease:cubic-bezier\(\.16,1,\.3,1\)/);
  assert.match(css, /\.hero-headline\{margin-bottom:24px;animation:hero-headline 1\.5s var\(--hero-ease\) both\}/);
  assert.match(css, /\.hero-subline\{animation:hero-subline 1\.2s \.3s var\(--hero-ease\) both\}/);
  assert.match(css, /animation:cursor-blink \.8s linear infinite/);
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/, 'no remote asset (CSP)');
});
