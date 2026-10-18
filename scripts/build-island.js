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

// Planches photographiques (signature.css) : un cadrage de la plage de l'accueil par rubrique.
// immersive : la photographie occupe la bande / la colonne ; flow : bande plus basse (réservation) ;
// plate : tirage encadré sur fond coloré. Le salon n'a pas de photographie réelle : illustration déclarée comme telle.
const BOOKING_SCENE = { scene: 'mer', style: 'flow', plate: 'Planche 03', name: 'La mer' };
const ACCOUNT_SCENE = { scene: 'ciel', style: 'immersive', plate: 'Planche 07', name: 'Le ciel' };
const APPOINTMENT_SCENE = { scene: 'horizon', style: 'plate', plate: 'Planche 05', name: 'L’horizon' };
const SCENES = {
  'services.html': { scene: 'rivage', style: 'immersive', plate: 'Planche 02', name: 'Le rivage' },
  'booking.html': BOOKING_SCENE, 'calendar.html': BOOKING_SCENE, 'slots.html': BOOKING_SCENE, 'recap.html': BOOKING_SCENE, 'confirmation.html': BOOKING_SCENE,
  'shop.html': { scene: 'salon', style: 'plate', plate: 'Planche 04', name: 'L’atelier — illustration' },
  'appointments.html': APPOINTMENT_SCENE, 'appointment.html': APPOINTMENT_SCENE, 'history.html': APPOINTMENT_SCENE,
  'loyalty.html': { scene: 'coquillage', style: 'plate', plate: 'Planche 06', name: 'Le coquillage' },
  'account.html': ACCOUNT_SCENE, 'profile.html': ACCOUNT_SCENE, 'settings.html': ACCOUNT_SCENE
};
const SIZES = { rivage: [760, 880], mer: [820, 780], ciel: [790, 510], horizon: [820, 330], coquillage: [460, 250] };
// Les outils du barbier, au trait (ciseaux, peigne, rasoir) : une illustration, pas une photographie du salon.
const SALON_ART = `<svg class="scene-art" viewBox="0 -10 460 360" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
  + `<g transform="translate(6 40) rotate(-14 120 70)"><rect x="38" y="58" width="150" height="22" rx="11"/><path d="M188 69h10"/><path d="M198 58c48-6 104-4 156 2c6 1 8 6 4 10c-4 4-10 6-16 6H198z"/><path d="M212 66h120" opacity=".5"/><circle cx="60" cy="69" r="4"/></g>`
  + `<circle cx="132" cy="222" r="26"/><circle cx="188" cy="252" r="26"/><circle cx="132" cy="222" r="15" opacity=".5"/><circle cx="188" cy="252" r="15" opacity=".5"/>`
  + `<path d="M152 205l58-46l136-104c4-3 9 1 6 5L226 170z"/><path d="M206 232l40-50l150-96c4-2 8 2 5 6L254 196z"/><circle cx="228" cy="178" r="4.5"/>`
  + `<rect x="70" y="292" width="320" height="14" rx="4"/>`
  + Array.from({ length: 39 }, (_, i) => `<path d="M${78 + i * 8} 306v${i % 2 ? 22 : 28}"/>`).join('')
  + `</svg>`;
function scene(file) {
  const config = SCENES[file];
  if (!config) return '';
  const media = config.scene === 'salon' ? SALON_ART
    : `<img src="/media/scenes/${config.scene}.webp" alt="" width="${SIZES[config.scene][0]}" height="${SIZES[config.scene][1]}" decoding="async" fetchpriority="high">`;
  return `<figure class="scene" aria-hidden="true">${media}<span class="scene-fade"></span>`
    + `<figcaption><span class="scene-plate">${config.plate}</span><span class="scene-name">${config.name}</span></figcaption></figure>`;
}
// Polices des titres et du texte préchargées : évite le saut de police au chargement.
const PRELOAD = '<link rel="preload" href="/fonts/InstrumentSerif-Regular.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/Inter-Variable.woff2" as="font" type="font/woff2" crossorigin>';
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