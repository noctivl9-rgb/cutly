const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicPath = path.join(__dirname, '../public');
const read = file => fs.readFileSync(path.join(publicPath, file), 'utf8');
const clientPages = ['index.html', 'services.html', 'shop.html', 'booking.html', 'calendar.html', 'slots.html', 'recap.html', 'confirmation.html',
  'appointments.html', 'appointment.html', 'history.html', 'account.html', 'profile.html', 'settings.html', 'loyalty.html',
  'terms.html', 'privacy.html', 'legal.html', 'terms-of-use.html', 'cancellation.html', 'install.html'];

test('every client page shares one Liquid Glass top bar (logo, four sections, account, Réserver) and no bottom tab bar', () => {
  for (const page of clientPages) {
    const html = read(page);
    assert.match(html, /href="\/mobile-app\.css"/, `${page} uses the design system`);
    assert.match(html, /href="\/glass\.css"/, `${page} loads the glass bar`);
    assert.ok(html.includes('<script src="/signature.js" defer></script>'), `${page} loads the bar behaviour`);
    assert.doesNotMatch(html, /island|bottom-nav/, `${page} has no Dynamic Island nor bottom tab bar`);
    const bar = page === 'index.html' ? read('assets/home/home.js') : (html.match(/<header class="topbar" data-topbar>[\s\S]*?<\/header>/) || [''])[0];
    for (const part of ['topbar-logo', 'topbar-links', 'topbar-account', 'topbar-cta']) assert.ok(bar.includes(part), `${page} bar has ${part}`);
    if (page !== 'index.html') {
      const targets = [...bar.matchAll(/<a (?:class="[^"]+" )?href="([^"]+)"/g)].map(match => match[1]);
      assert.deepEqual(targets, ['/', '/services.html', '/shop.html', '/appointments.html', '/loyalty.html', '/profile.html', '/booking.html'], `${page} bar links`);
      assert.ok((bar.match(/aria-current="page"/g) || []).length <= 1, `${page} has at most one active section`);
    }
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

test('home hero is the React build of the provided spec, adapted to CUTLY, with self-hosted assets', () => {
  const home = read('index.html');
  assert.ok(home.includes('<div id="cutly-home-root"></div>'));
  assert.ok(home.includes('<script type="module" src="/assets/home/home.js"></script>'));
  assert.ok(home.includes('<link rel="stylesheet" href="/assets/home/home.css">'));
  for (const file of ['assets/home/home.js', 'assets/home/home.css', 'media/cutly-hero.mp4', 'fonts/InstrumentSerif-Regular.ttf', 'fonts/Inter-Variable.ttf', 'fonts/PixelifySans-Variable.ttf']) {
    assert.ok(fs.existsSync(path.join(publicPath, file)), `${file} is published`);
  }
  const bundle = read('assets/home/home.js');
  for (const text of ['Réserver une coupe', '/booking.html', '/services.html', '/shop.html', '/appointments.html', '/loyalty.html', 'Coupe nette.', 'Heure juste.', '/media/cutly-hero.mp4']) assert.ok(bundle.includes(text), `bundle contains ${text}`);
  assert.doesNotMatch(bundle, /Short notes|Link up|Philosophy/, 'reference copy never ships');
  const source = fs.readFileSync(path.join(__dirname, '../hero/App.tsx'), 'utf8');
  for (const snippet of ['deleting ? 50 : 100', 'setTimeout(() => setDeleting(true), 2000)', 'const EASE = [0.16, 1, 0.3, 1]',
    'duration: 1.5, delay: textDelay, ease: EASE', 'duration: 1.2, delay: textDelay + 0.3, ease: EASE', 'onLoadedData={() => setPhoneReady(true)}', "duration: 0.8, repeat: Infinity, ease: 'linear'"]) {
    assert.ok(source.includes(snippet), `App.tsx keeps ${snippet}`);
  }
  const css = read('assets/home/home.css');
  assert.doesNotMatch(css, /url\(\s*['"]?https?:/, 'no remote asset (CSP)');
});
