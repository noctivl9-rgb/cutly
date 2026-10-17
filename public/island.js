// Dynamic Island CUTLY : ouverture/fermeture sur iPhone et état du salon (ouvert / fermé) calculé
// à partir des horaires réels renvoyés par /api/shop, à l'heure de Paris.
(() => {
  const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let shopPromise;
  const loadShop = () => (shopPromise ??= fetch('/api/shop', { credentials: 'same-origin' }).then(r => (r.ok ? r.json() : null)).catch(() => null));

  function parisNow() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date()).map(p => [p.type, p.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return { weekday, minutes: Number(parts.hour) % 24 * 60 + Number(parts.minute) };
  }
  const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const dayName = row => row.day.charAt(0).toUpperCase() + row.day.slice(1);

  // « Ouvert · jusqu'à 19:00 » ou « Fermé · ouvre samedi à 09:00 ».
  function openingStatus(hours) {
    const now = parisNow();
    const today = hours.find(h => h.weekday === now.weekday);
    if (today?.open && now.minutes >= toMinutes(today.open) && now.minutes < toMinutes(today.close)) return { open: true, text: `Ouvert · jusqu’à ${today.close}` };
    for (let offset = 0; offset < 8; offset++) {
      const row = hours.find(h => h.weekday === (now.weekday + offset) % 7);
      if (!row?.open || (offset === 0 && now.minutes >= toMinutes(row.open))) continue;
      const when = offset === 0 ? 'aujourd’hui' : offset === 1 ? 'demain' : dayName(row).toLowerCase();
      return { open: false, text: `Fermé · ouvre ${when} à ${row.open}` };
    }
    return { open: false, text: 'Fermé' };
  }

  function setup(island) {
    if (island.dataset.ready) return;
    island.dataset.ready = '1';
    const toggle = island.querySelector('[data-island-toggle]');
    const panel = island.querySelector('.island-panel');
    if (!toggle || !panel) return;
    const scrim = document.createElement('div');
    scrim.className = 'island-scrim';
    island.before(scrim);
    const closedWidth = () => { island.style.removeProperty('--island-w'); };
    const open = () => {
      island.style.setProperty('--island-w', `${island.getBoundingClientRect().width}px`);
      requestAnimationFrame(() => {
        island.style.setProperty('--island-w', 'min(380px, calc(100vw - 24px))');
        island.setAttribute('data-open', '');
        toggle.setAttribute('aria-expanded', 'true');
        panel.removeAttribute('inert');
        scrim.classList.add('is-visible');
      });
      refreshStatus(island);
    };
    const close = ({ focus = false } = {}) => {
      island.removeAttribute('data-open');
      toggle.setAttribute('aria-expanded', 'false');
      panel.setAttribute('inert', '');
      scrim.classList.remove('is-visible');
      if (reduced()) closedWidth(); else setTimeout(closedWidth, 280);
      if (focus) toggle.focus();
    };
    panel.setAttribute('inert', '');
    toggle.addEventListener('click', () => (island.hasAttribute('data-open') ? close() : open()));
    scrim.addEventListener('click', () => close());
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && island.hasAttribute('data-open')) close({ focus: true }); });
    window.matchMedia('(min-width: 900px)').addEventListener?.('change', () => close());
  }

  async function refreshStatus(island) {
    const target = island.querySelector('[data-island-status]');
    if (!target) return;
    const shop = await loadShop();
    if (!shop?.hours) { target.textContent = ''; return; }
    const status = openingStatus(shop.hours);
    target.textContent = status.text;
    target.classList.toggle('is-open', status.open);
  }

  const init = () => document.querySelectorAll('[data-island]').forEach(setup);
  init();
  // L'accueil (React) insère son île après le chargement.
  if (!document.querySelector('[data-island]')) {
    const observer = new MutationObserver(() => { if (document.querySelector('[data-island]')) { init(); observer.disconnect(); } });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
