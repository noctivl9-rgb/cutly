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
