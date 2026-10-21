// Illustrations vectorielles : portraits, pièces à conviction, plan de l'hôtel, pictogrammes.
import { s } from './core.js';

export function logo(size = 28) {
  return s('svg', { viewBox: '0 0 40 40', width: size, height: size, 'aria-hidden': 'true', class: 'logo-mark' },
    s('rect', { x: 2, y: 2, width: 36, height: 36, rx: 3, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }),
    s('path', { d: 'M11 11 L29 29 M29 11 L11 29', stroke: 'var(--red)', 'stroke-width': 4, 'stroke-linecap': 'square' }),
  );
}

const ICONS = {
  dossier: 'M3 6h6l2 2h10v11H3z',
  explorer: 'M4 5l5-2 6 2 5-2v16l-5 2-6-2-5 2z M9 3v16 M15 5v16',
  preuves: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  tableau: 'M3 4h18v14H3z M7 9l4 4 6-5 M8 21h8',
  profil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c1-4 4-6 8-6s7 2 8 6',
  scan: 'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M7 12h10',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M16 16l5 5',
  lock: 'M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4',
  envelope: 'M3 6h18v12H3z M3 6l9 7 9-7',
  link: 'M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1 M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1',
  plus: 'M12 5v14 M5 12h14',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
};
export function icon(name, size = 22) {
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'aria-hidden': 'true', class: 'icon' },
    s('path', { d: ICONS[name] ?? ICONS.dossier }));
}

/** Portrait d'identité stylisé, propre à chaque personnage. */
export function portrait(character, size = 96) {
  const p = character?.portrait ?? {};
  const tone = p.tone ?? '#9a8070';
  const id = `g${(character?.ref ?? 'x').replace(/[^a-z0-9]/gi, '')}${size}`;
  const parts = [];
  // Accessoires spécifiques
  switch (p.accessory) {
    case 'toque':
      parts.push(s('path', { d: 'M34 30 q-6-14 8-14 q8-10 16 0 q14 0 8 14 z', fill: '#F0ECE4', opacity: 0.92 }), s('rect', { x: 34, y: 29, width: 32, height: 6, fill: '#F0ECE4', opacity: 0.8 }));
      break;
    case 'lunettes':
      parts.push(
        s('circle', { cx: 43, cy: 45, r: 5, fill: 'none', stroke: '#0B0C0E', 'stroke-width': 1.6 }),
        s('circle', { cx: 57, cy: 45, r: 5, fill: 'none', stroke: '#0B0C0E', 'stroke-width': 1.6 }),
        s('path', { d: 'M48 45h4', stroke: '#0B0C0E', 'stroke-width': 1.6 }),
        s('path', { d: 'M44 58 q6 3 12 0', stroke: '#5b4a3e', 'stroke-width': 2.5, fill: 'none' }),
      );
      break;
    case 'chignon':
      parts.push(s('circle', { cx: 50, cy: 22, r: 9, fill: '#3a302b' }), s('path', { d: 'M33 44 q0-20 17-20 q17 0 17 20 q-4-12-17-12 q-13 0-17 12z', fill: '#3a302b' }));
      break;
    case 'col':
      parts.push(s('path', { d: 'M38 74 l12 10 12-10 -4 16 -8-6 -8 6z', fill: '#F0ECE4', opacity: 0.85 }), s('path', { d: 'M33 46 q0-22 17-22 q17 0 17 22 q-6-14-17-14 q-11 0-17 14z', fill: '#2c2420' }));
      break;
    case 'blouson':
      parts.push(s('path', { d: 'M22 100 l8-24 q20-8 40 0 l8 24z', fill: '#5a3a26' }), s('path', { d: 'M40 76 l10 14 10-14', stroke: '#2a1a10', 'stroke-width': 2, fill: 'none' }), s('path', { d: 'M34 42 q2-18 16-18 q16 0 17 16 q-8-6-16-6 q-10 0-17 8z', fill: '#2c2420' }));
      break;
    case 'perles':
      for (let i = 0; i < 9; i++) parts.push(s('circle', { cx: 38 + i * 3, cy: 78 + Math.sin((i / 8) * Math.PI) * 5, r: 1.6, fill: '#F0ECE4' }));
      parts.push(s('path', { d: 'M31 52 q-2-28 19-28 q21 0 19 28 q-2 10-6 14 q2-22-13-24 q-15 2-13 24 q-4-4-6-14z', fill: '#1f1a18' }));
      break;
  }
  return s('svg', { viewBox: '0 0 100 100', width: size, height: size, class: 'portrait', role: 'img', 'aria-label': `Portrait de ${character?.name ?? 'personnage'}` },
    s('defs', null,
      s('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': '#2a2d33' }), s('stop', { offset: 1, 'stop-color': '#121316' })),
    ),
    s('rect', { width: 100, height: 100, fill: `url(#${id})` }),
    s('path', { d: 'M0 88h100 M0 92h100', stroke: '#ffffff', 'stroke-opacity': 0.05 }),
    s('path', { d: 'M18 100 q4-26 32-26 q28 0 32 26z', fill: tone, opacity: 0.55 }),
    s('rect', { x: 44, y: 60, width: 12, height: 14, fill: tone, opacity: 0.75 }),
    s('ellipse', { cx: 50, cy: 46, rx: 15, ry: 18, fill: tone }),
    ...parts,
    s('text', { x: 6, y: 96, 'font-family': 'IBM Plex Mono, monospace', 'font-size': 7, fill: '#F0ECE4', opacity: 0.55 }, (character?.ref ?? '').replace('PER-', '')),
  );
}

/** Illustration d'une pièce selon son type. */
export function evidenceArt(type, size = 64) {
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const shapes = {
    scene: [s('rect', { x: 8, y: 14, width: 48, height: 36, ...stroke }), s('path', { d: 'M8 40l14-10 10 8 10-12 14 14', ...stroke }), s('circle', { cx: 46, cy: 22, r: 4, ...stroke })],
    objet: [s('path', { d: 'M32 10l18 10v24L32 54 14 44V20z', ...stroke }), s('path', { d: 'M14 20l18 10 18-10 M32 30v24', ...stroke })],
    document: [s('path', { d: 'M18 8h20l10 10v38H18z M38 8v10h10', ...stroke }), s('path', { d: 'M24 28h18 M24 34h18 M24 40h12', ...stroke })],
    photo: [s('rect', { x: 10, y: 12, width: 44, height: 40, ...stroke }), s('rect', { x: 15, y: 17, width: 34, height: 26, ...stroke }), s('circle', { cx: 32, cy: 28, r: 6, ...stroke })],
    rapport: [s('path', { d: 'M16 10h32v44H16z', ...stroke }), s('path', { d: 'M22 20h20 M22 26h20 M22 32h14', ...stroke }), s('circle', { cx: 40, cy: 44, r: 5, ...stroke })],
    temoignage: [s('path', { d: 'M10 14h44v26H30l-10 10V40H10z', ...stroke }), s('path', { d: 'M18 24h28 M18 31h18', ...stroke })],
  };
  return s('svg', { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', class: 'evidence-art' }, ...(shapes[type] ?? shapes.objet));
}

// Plan de l'hôtel : rez-de-chaussée et premier étage
export const PLAN = {
  'LIEU-CHAMBRES': { d: 'M20 20h320v86H20z', label: [180, 66], floor: 1 },
  'LIEU-RESERVE': { d: 'M20 140h90v88H20z', label: [65, 186] },
  'LIEU-CUISINE': { d: 'M110 140h120v88H110z', label: [170, 186] },
  'LIEU-RESTAURANT': { d: 'M230 140h110v148H230z', label: [285, 216] },
  'LIEU-ESCALIER': { d: 'M20 228h58v84H20z', label: [49, 272] },
  'LIEU-COULOIRS': { d: 'M78 228h152v40H78z', label: [154, 251] },
  'LIEU-BUREAU': { d: 'M78 268h96v86H78z', label: [126, 314] },
  'LIEU-SALON': { d: 'M230 288h110v122H230z', label: [285, 352] },
  'LIEU-RECEPTION': { d: 'M20 312h58v98H20z M78 354h96v56H78z', label: [112, 386] },
  'LIEU-HALL': { d: 'M174 268h56v142H174z M20 410h320v80H20z', label: [180, 454] },
};

export function hotelPlan(locations, { onSelect, selected } = {}) {
  const byRef = new Map(locations.map((l) => [l.ref, l]));
  const svg = s('svg', { viewBox: '0 0 360 510', class: 'plan', role: 'group', 'aria-label': "Plan interactif du Grand Hôtel" },
    s('defs', null,
      s('pattern', { id: 'hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: '#777C84', 'stroke-width': 1, 'stroke-opacity': 0.35 })),
    ),
    s('text', { x: 20, y: 14, class: 'plan-floor' }, '1er ÉTAGE'),
    s('text', { x: 20, y: 134, class: 'plan-floor' }, 'REZ-DE-CHAUSSÉE'),
    s('path', { d: 'M49 228 V106', class: 'plan-stair', 'stroke-dasharray': '3 4' }),
    s('path', { d: 'M202 268 V106', class: 'plan-stair plan-stair-main', 'stroke-dasharray': '1 5' }),
    s('text', { x: 206, y: 124, class: 'plan-note' }, 'escalier d’honneur'),
  );
  for (const [ref, geo] of Object.entries(PLAN)) {
    const loc = byRef.get(ref);
    if (!loc) continue;
    const count = loc.items?.length ?? 0;
    const g = s('g', {
      class: `room ${loc.locked ? 'locked' : ''} ${loc.visited ? 'visited' : ''} ${selected === ref ? 'selected' : ''}`,
      tabindex: 0, role: 'button', 'aria-label': `${loc.name}${loc.locked ? ' — verrouillé' : ''}${count ? `, ${count} preuve${count > 1 ? 's' : ''}` : ''}`,
      onclick: () => onSelect?.(ref),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect?.(ref)),
    },
      s('path', { d: geo.d, class: 'room-shape' }),
      loc.locked ? s('path', { d: geo.d, fill: 'url(#hatch)', 'pointer-events': 'none' }) : null,
      s('text', { x: geo.label[0], y: geo.label[1], class: 'room-label', 'text-anchor': 'middle' }, loc.name.toUpperCase()),
      count ? s('g', { class: 'room-badge' }, s('circle', { cx: geo.label[0] + 0, cy: geo.label[1] + 14, r: 8 }), s('text', { x: geo.label[0], y: geo.label[1] + 17.5, 'text-anchor': 'middle' }, String(count))) : null,
      loc.locked ? s('text', { x: geo.label[0], y: geo.label[1] + 16, class: 'room-lock', 'text-anchor': 'middle' }, `ÉTAPE ${loc.stage}`) : null,
    );
    svg.append(g);
  }
  return svg;
}

/** Vignette de plan mettant en évidence une pièce (illustration de fiche de lieu). */
export function roomThumb(ref) {
  const geo = PLAN[ref];
  const svg = s('svg', { viewBox: '0 0 360 510', class: 'room-thumb', 'aria-hidden': 'true' });
  for (const [r, g] of Object.entries(PLAN)) svg.append(s('path', { d: g.d, class: r === ref ? 'thumb-on' : 'thumb-off' }));
  if (!geo) return svg;
  return svg;
}
