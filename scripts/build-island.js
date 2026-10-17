// Génère l'en-tête « Dynamic Island » commun à toutes les pages clientes (hors accueil React).
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
const PANEL_LINKS = [['Prestations', '/services.html'], ['Le salon et les avis', '/shop.html'], ['Fidélité', '/loyalty.html'], ['Conditions générales', '/terms.html']];
const SECTION = { 'services.html': '/services.html', 'shop.html': '/shop.html', 'appointments.html': '/appointments.html', 'appointment.html': '/appointments.html', 'history.html': '/appointments.html', 'loyalty.html': '/loyalty.html' };

function island(file) {
  const current = SECTION[file];
  const links = LINKS.map(([label, href]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const panelLinks = PANEL_LINKS.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  return `<header class="island" data-island><div class="island-shell"><div class="island-bar">`
    + `<a class="island-logo" href="/" aria-label="CUTLY, accueil">CUTLY</a>`
    + `<nav class="island-links" aria-label="Navigation principale">${links}</nav>`
    + `<a class="island-account" href="/profile.html" aria-label="Mon profil"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg></a>`
    + `<a class="island-cta" href="/booking.html">Réserver</a>`
    + `<button class="island-toggle" type="button" data-island-toggle aria-expanded="false" aria-controls="island-panel">${CONTEXT[file]}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>`
    + `</div><div class="island-panel" id="island-panel"><div><div class="island-panel-inner">`
    + `<p class="island-shop">Thomas Shop</p><p class="island-status" data-island-status role="status"></p><p class="island-meta">8 cours de l’Île Seguin, Boulogne-Billancourt</p>`
    + `<nav class="island-panel-links" aria-label="Liens secondaires">${panelLinks}</nav>`
    + `</div></div></div></div></header>`;
}

let changed = 0;
for (const file of Object.keys(CONTEXT)) {
  const target = path.join(PUBLIC, file);
  let html = fs.readFileSync(target, 'utf8');
  const before = html;
  html = html.replace(/<header class="(?:app-header|island)"[\s\S]*?<\/header>/, island(file));
  if (!html.includes('src="/island.js"')) html = html.replace('</head>', '<script src="/island.js" defer></script></head>');
  if (html !== before) { fs.writeFileSync(target, html); changed++; }
}
console.log(`Île installée ou mise à jour sur ${changed} page(s).`);
