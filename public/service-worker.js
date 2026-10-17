const CACHE_NAME = 'cutly-public-shell-v3';
const SHELL_FILES = [
  '/offline.html',
  '/install.html',
  '/install.css',
  '/mobile-app.css',
  '/favicon.svg',
  '/icons/cutly-192.png',
  '/icons/cutly-512.png',
  '/icons/apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('cutly-public-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () =>
      (await caches.match('/offline.html')) || Response.error()
    ));
    return;
  }

  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())));
      return response;
    }).catch(async () => (await caches.match(request)) || Response.error()));
  }
});
