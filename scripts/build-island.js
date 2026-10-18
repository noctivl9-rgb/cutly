// Génère la barre Liquid Glass et les planches photographiques de toutes les pages clientes (hors accueil React).
// Usage : node scripts/build-island.js  — réécrit l'en-tête de chaque page de public/ de façon idempotente.
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const CONTEXT = {
  'services.html': 'Prestations', 'shop.html': 'Le salon', 'booking.html': 'Réservation · 1/5', 'calendar.html': 'Réservation · 2/5',
  'slots.html': 'Réservation · 3/5', 'recap.html': 'Réservation · 5/5', 'confirmation.html': 'Demande envoyée', 'appointments.html': 'Mes rendez-vous',
  'appointment.html': 'Rendez-vous', 'history.html': 'Historique', 'account.html': 'Compte', 'profile.html': 'Profil', 'settings.html': 'Paramètres',
  'loyalty.html': 'Fidélité', 'terms.html': 'Informations', 'privacy.html': 'Informations', 'legal.html': 'Informations', 'terms-of-use.html': 'Informations',
  'cancellation.html': 'Informations', 'install.html': 'Installer CUTLY'
};
const LINKS = [['Prestations', '/services.html'], ['Le salon', '/shop.html'], ['Rendez-vous', '/appointments.html'], ['Fidélité', '/loyalty.html']];
const SECTION = { 'services.html': '/services.html', 'shop.html': '/shop.html', 'appointments.html': '/appointments.html', 'appointment.html': '/appointments.html', 'history.html': '/appointments.html', 'loyalty.html': '/loyalty.html' };
const ACCOUNT_PAGES = new Set(['account.html', 'profile.html', 'settings.html']);

// Barre Liquid Glass : logo, quatre rubriques, compte, « Réserver ». Même balisage sur l'accueil (hero/App.tsx).
function topbar(file) {
  const current = SECTION[file];
  const links = LINKS.map(([label, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<header class="topbar" data-topbar><div class="topbar-glass">`
    + `<a class="topbar-logo" href="/" aria-label="CUTLY, accueil">CUTLY</a>`
    + `<nav class="topbar-links" aria-label="Navigation principale">${links}</nav>`
    + `<a class="topbar-account" href="/profile.html" aria-label="Mon profil"${ACCOUNT_PAGES.has(file) ? ' aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg></a>`
    + `<a class="topbar-cta" href="/booking.html">Réserver</a>`
    + `</div></header>`;
}

// Bandeau photographique discret (signature.css) sur trois pages seulement : un cadrage de la plage de l'accueil.
const SCENES = {
  'services.html': { scene: 'rivage', style: 'banner' },
  'shop.html': { scene: 'horizon', style: 'banner' }
};
const SIZES = { rivage: [760, 880], mer: [820, 780], ciel: [790, 510], horizon: [820, 330], coquillage: [460, 250] };
function scene(file) {
  const config = SCENES[file];
  if (!config) return '';
  return `<figure class="scene" aria-hidden="true"><img src="/media/scenes/${config.scene}.webp" alt="" width="${SIZES[config.scene][0]}" height="${SIZES[config.scene][1]}" decoding="async" fetchpriority="high"></figure>`;
}
// Police des pages secondaires préchargée : évite le saut de police au chargement.
const PRELOAD = '<link rel="preload" href="/fonts/Geist-Variable.woff2" as="font" type="font/woff2" crossorigin>';
const STYLES = '<link rel="stylesheet" href="/glass.css"><link rel="stylesheet" href="/signature.css">';

let changed = 0;
for (const file of Object.keys(CONTEXT)) {
  const target = path.join(PUBLIC, file);
  let html = fs.readFileSync(target, 'utf8');
  const before = html;
  html = html.replace(/<header class="(?:app-header|island|topbar)"[\s\S]*?<\/header>/, topbar(file));
  // Une seule navigation, en haut : plus de barre d'onglets ni de script d'île.
  html = html.replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, '').replace('<script src="/island.js" defer></script>', '');
  // Feuilles signature : toujours en dernier, pour primer sur les feuilles propres à chaque page.
  html = html.replace(/<link rel="stylesheet" href="\/(?:glass|signature)\.css">|<script src="\/signature\.js" defer><\/script>|<link rel="preload" href="\/fonts\/[^"]+\.woff2" as="font" type="font\/woff2" crossorigin>/g, '')
    .replace('</head>', `${PRELOAD}${STYLES}<script src="/signature.js" defer></script></head>`);
  html = html.replace(/<figure class="scene"[\s\S]*?<\/figure>/, '').replace(/ data-scene(?:-style)?="[^"]*"/g, '');
  if (SCENES[file]) {
    html = html.replace(/<body([^>]*)>/, `<body$1 data-scene="${SCENES[file].scene}" data-scene-style="${SCENES[file].style}">`);
    html = html.replace('</header>', `</header>${scene(file)}`);
  }
  if (html !== before) { fs.writeFileSync(target, html); changed++; }
}
// Accueil : seule la barre change (verre) — aucune planche, aucune feuille signature.
const home = path.join(PUBLIC, 'index.html');
let homeHtml = fs.readFileSync(home, 'utf8');
const homeBefore = homeHtml;
if (!homeHtml.includes('href="/glass.css"')) homeHtml = homeHtml.replace('<link rel="stylesheet" href="/mobile-app.css">', '<link rel="stylesheet" href="/mobile-app.css"><link rel="stylesheet" href="/glass.css">');
homeHtml = homeHtml.replace('<script src="/island.js" defer></script>', '').replace(/<nav class="bottom-nav"[\s\S]*?<\/nav>/, '');
if (!homeHtml.includes('src="/signature.js"')) homeHtml = homeHtml.replace('</head>', '<script src="/signature.js" defer></script></head>');
if (homeHtml !== homeBefore) { fs.writeFileSync(home, homeHtml); changed++; }
console.log(`Barre de verre et planches installées ou mises à jour sur ${changed} page(s).`);