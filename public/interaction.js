(() => {
  const storageKey = 'cutly-haptics';
  const canVibrate = typeof navigator.vibrate === 'function';
  const enabled = () => {
    try { return localStorage.getItem(storageKey) !== 'off'; } catch { return true; }
  };
  const feedback = type => {
    if (!canVibrate || !enabled() || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    try { navigator.vibrate(type === 'confirm' ? [12, 35, 18] : type === 'error' ? [20, 35, 20] : 10); } catch {}
  };

  window.CutlyFeedback = feedback;
  const updateNavigation = () => {
    const currentLocation = window.location || (typeof location !== 'undefined' ? location : null);
    if (!currentLocation) return;
    const accountPage = currentLocation.pathname.endsWith('/account.html');
    for (const link of document.querySelectorAll('.mobile-nav a')) {
      const href = link.getAttribute('href') || '';
      const active = accountPage
          ? (href.includes('#appointments') ? currentLocation.hash === '#appointments' : href.includes('#account-dashboard') ? currentLocation.hash !== '#appointments' : false)
        : (href === '#reserver' ? currentLocation.hash === '#reserver' : href === '#accueil' && !currentLocation.hash);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  };
  updateNavigation();
  window.addEventListener?.('hashchange', updateNavigation);
  window.addEventListener?.('popstate', updateNavigation);
  for (const control of document.querySelectorAll('[data-toggle-haptics]')) {
    if (!canVibrate) {
      control.hidden = true;
      control.closest?.('.admin-settings')?.setAttribute('hidden', '');
      continue;
    }
    const render = () => {
      const active = enabled();
      control.setAttribute('aria-pressed', String(active));
      control.textContent = active ? 'Retours tactiles : activés' : 'Retours tactiles : désactivés';
    };
    control.addEventListener('click', () => {
      try { localStorage.setItem(storageKey, enabled() ? 'off' : 'on'); } catch {}
      render();
    });
    render();
  }
})();
