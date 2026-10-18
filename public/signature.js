// CUTLY — barre Liquid Glass : indicateur liquide entre les rubriques, reflet qui suit le pointeur,
// verre légèrement plus dense une fois la page défilée. Rien n'est recalculé image par image pendant le défilement
// et aucun contenu n'est masqué en attendant un script : sans ce fichier, les pages restent complètes.
(() => {
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

  function glassLight(surface) {
    if (surface.dataset.light) return;
    surface.dataset.light = '1';
    surface.addEventListener('pointermove', event => {
      if (!finePointer.matches) return;
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--gx', `${((event.clientX - box.left) / box.width * 100).toFixed(1)}%`);
      surface.style.setProperty('--gy', `${((event.clientY - box.top) / box.height * 100).toFixed(1)}%`);
    });
    surface.addEventListener('pointerleave', () => { surface.style.removeProperty('--gx'); surface.style.removeProperty('--gy'); });
  }

  // Indicateur : une pastille de verre sous la rubrique active, qui glisse vers la rubrique visée ou touchée.
  function indicator(nav) {
    if (nav.classList.contains('has-indicator')) return;
    const pill = document.createElement('span');
    pill.className = 'nav-indicator';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
    nav.classList.add('has-indicator');
    const links = [...nav.querySelectorAll('a')];
    const current = () => nav.querySelector('a[aria-current=page]');
    const moveTo = (link, { instant = false } = {}) => {
      links.forEach(a => a.classList.toggle('is-target', a === link));
      if (!link) { pill.classList.remove('is-visible'); return; }
      if (instant) pill.style.transition = 'none';
      pill.style.setProperty('--ix', `${link.offsetLeft}px`);
      pill.style.setProperty('--iw', `${link.offsetWidth}px`);
      pill.classList.add('is-visible');
      if (instant) requestAnimationFrame(() => requestAnimationFrame(() => pill.style.removeProperty('transition')));
    };
    links.forEach(link => {
      link.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') moveTo(link); });
      link.addEventListener('focus', () => moveTo(link));
      link.addEventListener('pointerdown', () => { moveTo(link); pill.classList.add('is-pressed'); });
    });
    const release = () => pill.classList.remove('is-pressed');
    addEventListener('pointerup', release); addEventListener('pointercancel', release);
    nav.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') moveTo(current()); });
    nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget)) moveTo(current()); });
    const place = () => moveTo(nav.querySelector('a.is-target') || current(), { instant: true });
    new ResizeObserver(place).observe(nav);
    document.fonts?.ready.then(place);
    place();
  }

  function setup() {
    const bar = document.querySelector('.topbar');
    if (!bar) return false;
    const glass = bar.querySelector('.topbar-glass');
    if (glass) glassLight(glass);
    const nav = bar.querySelector('.topbar-links');
    if (nav) indicator(nav);
    let scrolled = null, tone = null, pending = false;
    // Teinte du verre : on regarde ce qui passe juste sous la barre (premier fond opaque, ou data-bar-tone).
    const toneBelow = () => {
      const y = bar.getBoundingClientRect().bottom + 2;
      let node = document.elementFromPoint(innerWidth / 2, Math.min(y, innerHeight - 1));
      while (node && node !== document.documentElement) {
        if (node.dataset?.barTone) return node.dataset.barTone;
        const color = getComputedStyle(node).backgroundColor.match(/[\d.]+/g);
        if (color && (color.length < 4 || Number(color[3]) > 0.5)) {
          const [r, g, b] = color.map(Number);
          return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45 ? 'dark' : 'light';
        }
        node = node.parentElement;
      }
      return 'light';
    };
    const update = () => {
      pending = false;
      const now = scrollY > 12;
      if (now !== scrolled) { scrolled = now; bar.toggleAttribute('data-scrolled', now); }
      const next = toneBelow();
      if (next !== tone) { tone = next; bar.dataset.tone = next; }
    };
    addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
    return true;
  }

  // Salon : le jour courant est mis en avant dans les horaires.
  function markToday() {
    const hours = document.querySelector('#hours');
    if (!hours) return;
    const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }).format(new Date()).toLowerCase();
    const apply = () => hours.querySelectorAll('.hours-row').forEach(row => row.classList.toggle('is-today', row.textContent.toLowerCase().startsWith(today)));
    apply(); new MutationObserver(apply).observe(hours, { childList: true });
  }

  function init() {
    markToday();
    if (setup()) return;
    // L'accueil (React) insère sa barre après le chargement.
    const observer = new MutationObserver(() => { if (setup()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
