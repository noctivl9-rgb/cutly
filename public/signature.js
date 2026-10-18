// CUTLY — effets signature : verre (reflet qui suit le pointeur, réfraction sur Chromium, état au défilement),
// indicateur liquide de la navigation, révélation typographique, profondeur photographique, micro-détails.
// Tout est facultatif : sans ce script, les pages restent complètes et utilisables.
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const root = document.documentElement;

  /* ---------- Verre ---------- */
  // Réfraction : filtre SVG appliqué à l'arrière-plan (Chromium uniquement ; ailleurs, flou classique).
  const chromium = navigator.userAgentData?.brands?.some(brand => /Chromium/.test(brand.brand));
  if (chromium && !matchMedia('(prefers-reduced-transparency: reduce)').matches) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    svg.innerHTML = '<filter id="cutly-refraction" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
      + '<feTurbulence type="fractalNoise" baseFrequency=".011 .019" numOctaves="2" seed="11" result="noise"/>'
      + '<feGaussianBlur in="noise" stdDeviation="2" result="soft"/>'
      + '<feDisplacementMap in="SourceGraphic" in2="soft" scale="16" xChannelSelector="R" yChannelSelector="G"/></filter>';
    document.body.append(svg);
    root.classList.add('glass-refract');
  }

  function glassLight(surface) {
    if (!finePointer.matches || surface.dataset.light) return;
    surface.dataset.light = '1';
    surface.addEventListener('pointermove', event => {
      const box = surface.getBoundingClientRect();
      surface.style.setProperty('--gx', `${((event.clientX - box.left) / box.width * 100).toFixed(1)}%`);
      surface.style.setProperty('--gy', `${((event.clientY - box.top) / box.height * 100).toFixed(1)}%`);
    });
    surface.addEventListener('pointerleave', () => { surface.style.removeProperty('--gx'); surface.style.removeProperty('--gy'); });
  }

  // Au défilement, le verre s'épaissit légèrement pour rester lisible au-dessus du contenu.
  let ticking = false;
  const onScroll = () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      document.querySelector('.island')?.toggleAttribute('data-scrolled', scrollY > 12);
      depth();
    });
  };

  /* ---------- Indicateur liquide (ordinateur) ---------- */
  function indicator(nav) {
    if (nav.querySelector('.nav-indicator')) return;
    const pill = document.createElement('span');
    pill.className = 'nav-indicator';
    pill.setAttribute('aria-hidden', 'true');
    nav.prepend(pill);
    const links = [...nav.querySelectorAll('a')];
    const current = () => nav.querySelector('a[aria-current=page]');
    const moveTo = (link, { instant = false } = {}) => {
      links.forEach(a => a.classList.toggle('is-target', a === link));
      if (!link) { pill.classList.remove('is-visible'); return; }
      if (instant) pill.style.transition = 'none';
      pill.style.setProperty('--ix', `${link.offsetLeft}px`);
      pill.style.setProperty('--iw', `${link.offsetWidth}px`);
      pill.classList.add('is-visible');
      if (instant) requestAnimationFrame(() => pill.style.removeProperty('transition'));
    };
    links.forEach(link => {
      link.addEventListener('pointerenter', () => moveTo(link));
      link.addEventListener('focus', () => moveTo(link));
      link.addEventListener('pointerdown', () => { moveTo(link); pill.classList.add('is-pressed'); });
    });
    const release = () => pill.classList.remove('is-pressed');
    addEventListener('pointerup', release); addEventListener('pointercancel', release);
    nav.addEventListener('pointerleave', () => moveTo(current()));
    nav.addEventListener('focusout', event => { if (!nav.contains(event.relatedTarget)) moveTo(current()); });
    const place = () => moveTo(current(), { instant: true });
    new ResizeObserver(place).observe(nav);
    document.fonts?.ready.then(place);
    place();
  }

  function setupNav() {
    document.querySelectorAll('.island-shell,.bottom-nav').forEach(glassLight);
    const nav = document.querySelector('.island-links');
    if (nav) indicator(nav);
  }

  /* ---------- Révélation typographique ---------- */
  // Chaque mot du titre monte derrière un masque ; le texte (et donc ce que lisent les lecteurs d'écran) ne change pas.
  function splitTitle(title) {
    if (title.dataset.split || title.children.length || !title.textContent.trim()) return;
    title.dataset.split = '1';
    const words = title.textContent.trim().split(/\s+/);
    title.textContent = '';
    words.forEach((word, index) => {
      const line = document.createElement('span'); line.className = 'reveal-line';
      const inner = document.createElement('span'); inner.textContent = word; inner.style.setProperty('--i', index);
      line.append(inner); title.append(line);
      if (index < words.length - 1) title.append(' ');
    });
  }
  const revealer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); revealer.unobserve(entry.target); }
  }, { rootMargin: '0px 0px -8% 0px' }) : null;
  const reveal = (element, delay = 0) => {
    if (!revealer || reducedMotion.matches || element.dataset.reveal !== undefined) return;
    element.dataset.reveal = '';
    element.style.setProperty('--d', `${delay}s`);
    revealer.observe(element);
  };

  function setupReveals() {
    if (document.body.dataset.page === 'home' || reducedMotion.matches || !revealer) return;
    document.querySelectorAll('main .page-title').forEach(title => { splitTitle(title); revealer.observe(title); });
    // Rangées chargées après coup (prestations, rendez-vous) : elles arrivent en cascade.
    const lists = document.querySelectorAll('#services, #appointments-list, #hours, #account-rewards');
    lists.forEach(list => {
      const mark = () => [...list.children].forEach((child, index) => reveal(child, Math.min(index, 8) * 0.05));
      mark(); new MutationObserver(mark).observe(list, { childList: true });
    });
    document.querySelectorAll('main .panel, main > section').forEach(section => reveal(section));
  }

  /* ---------- Profondeur photographique ---------- */
  const scene = document.querySelector('.scene img');
  let depthEnabled = Boolean(scene) && !reducedMotion.matches;
  function depth() {
    if (!depthEnabled) return;
    const wide = innerWidth >= 900;
    // iPhone : la photographie défile moins vite que la page ; ordinateur (colonne fixe) : lente dérive.
    const shift = wide ? Math.min(scrollY * -0.05, 0) : Math.min(scrollY * 0.32, 220);
    scene.style.setProperty('--py', `${shift.toFixed(1)}px`);
  }
  if (scene && !reducedMotion.matches) {
    scene.style.setProperty('--ps', '1.16');
    const settle = () => requestAnimationFrame(() => {
      scene.style.transition = 'transform 1.6s cubic-bezier(.16,1,.3,1)';
      scene.style.setProperty('--ps', '1.06');
      setTimeout(() => scene.style.removeProperty('transition'), 1700);
    });
    if (scene.complete) settle(); else scene.addEventListener('load', settle, { once: true });
  }

  /* ---------- Salon : le jour courant dans les horaires ---------- */
  function markToday() {
    const hours = document.querySelector('#hours');
    if (!hours) return;
    const today = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' }).format(new Date()).toLowerCase();
    const apply = () => hours.querySelectorAll('.hours-row').forEach(row => row.classList.toggle('is-today', row.textContent.toLowerCase().startsWith(today)));
    apply(); new MutationObserver(apply).observe(hours, { childList: true });
  }

  function init() {
    setupNav(); setupReveals(); markToday(); depth();
    addEventListener('scroll', onScroll, { passive: true });
    // L'accueil (React) insère sa barre après le chargement.
    if (!document.querySelector('.island-links')) {
      const observer = new MutationObserver(() => { if (document.querySelector('.island-links')) { setupNav(); observer.disconnect(); } });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
