/* Legal navigation preserves the booking draft and accepts only known local pages. */
(function (root) {
  'use strict';
  const allowed = new Set(['recap.html', 'booking.html', 'calendar.html', 'slots.html', 'account.html', 'profile.html', 'settings.html', 'services.html', 'index.html']);
  function returnPath(search) {
    const value = new URLSearchParams(search).get('return') || '';
    const name = value.startsWith('/') ? value.slice(1) : value;
    return allowed.has(name) ? `/${name}` : '/';
  }
  function initialize(document, location) {
    const target = returnPath(location.search);
    const back = document.querySelector('[data-legal-back]');
    if (back) {
      back.href = target;
      back.textContent = target === '/recap.html' ? '← Retour au récapitulatif' : '← Retour à CUTLY';
    }
    if (target !== '/') {
      for (const link of document.querySelectorAll('[data-legal-link]')) {
        const url = new URL(link.getAttribute('href'), location.origin);
        url.searchParams.set('return', target.slice(1));
        link.href = url.pathname + url.search;
      }
    }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { returnPath, initialize };
  else initialize(root.document, root.location);
})(typeof window !== 'undefined' ? window : globalThis);
