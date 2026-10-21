// Routage de l'application.
import { $, h } from './core.js';
import { logo } from './art.js';

const routes = [
  [/^\/$/, () => import('./views/home.js').then((m) => m.homeView())],
  [/^\/creer\/?$/, () => import('./views/create.js').then((m) => m.createView())],
  [/^\/rejoindre(?:\/([^/]+))?\/?$/, (code) => import('./views/join.js').then((m) => m.joinView(code))],
  [/^\/recuperer\/?$/, () => import('./views/join.js').then((m) => m.recoverView())],
  [/^\/partie\/([^/]+)\/?$/, (code) => import('./views/game.js').then((m) => m.gameView(code))],
  [/^\/organisateur\/([^/]+)\/?$/, (code) => import('./views/organizer.js').then((m) => m.organizerView(code))],
  [/^\/admin\/?$/, () => import('./views/admin.js').then((m) => m.adminView())],
  [/^\/q\/([a-z]+)\/([^/]+)\/?$/, (kind, key) => import('./views/qr.js').then((m) => m.qrView(kind, decodeURIComponent(key)))],
];

let cleanup = null;

async function render() {
  const app = $('#app');
  const path = location.pathname;
  cleanup?.();
  cleanup = null;
  for (const [re, fn] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    try {
      const view = await fn(...m.slice(1));
      app.replaceChildren(view.el ?? view);
      cleanup = view.destroy ?? null;
      window.scrollTo(0, 0);
    } catch (err) {
      console.error(err);
      app.replaceChildren(h('div', { class: 'loading-screen' }, h('div', null, logo(40), h('p', null, 'Impossible de charger cette page.'), h('a', { href: '/', class: 'btn' }, 'Accueil'))));
    }
    return;
  }
  app.replaceChildren(h('div', { class: 'loading-screen' }, h('div', null, logo(40), h('h2', null, 'Pièce introuvable'), h('p', { class: 'muted' }, "Cette adresse ne mène nulle part."), h('a', { href: '/', class: 'btn' }, 'Accueil'))));
}

window.addEventListener('popstate', render);
window.addEventListener('dx:navigate', render);
render();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
