// Service worker : met en cache l'interface (jamais les données de jeu, qui restent sur le serveur).
const VERSION = 'dx-shell-v1';
const SHELL = [
  '/', '/css/app.css', '/js/main.js', '/js/core.js', '/js/art.js',
  '/js/views/home.js', '/js/views/create.js', '/js/views/join.js', '/js/views/qr.js', '/js/views/game.js', '/js/views/board.js', '/js/views/organizer.js', '/js/views/admin.js',
  '/manifest.webmanifest', '/icons/icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Réseau d'abord, cache en secours : les mises à jour arrivent immédiatement.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && (SHELL.includes(url.pathname) || url.pathname.startsWith('/vendor/'))) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r ?? (e.request.mode === 'navigate' ? caches.match('/') : Response.error()))),
  );
});
