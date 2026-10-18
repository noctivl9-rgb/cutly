// Génère un aperçu HTML de chaque e-mail CUTLY avec des données d'exemple (aucun envoi, aucune donnée réelle).
// Usage : node scripts/preview-emails.js [dossier]   (par défaut data/email-previews)
// La bannière est remplacée par le fichier local pour l'affichage ; les vrais messages utilisent l'adresse HTTPS du site.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

process.env.CUTLY_PUBLIC_BASE_URL = process.env.CUTLY_PUBLIC_BASE_URL || 'https://cutlyt.netlify.app';
const { renderEmail } = require('../lib/email-templates');

const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data', 'email-previews'));
fs.mkdirSync(out, { recursive: true });
const banner = pathToFileURL(path.join(__dirname, '..', 'public', 'email', 'banner.jpg')).href;

const base = { firstName: 'Sarah', clientName: 'Sarah Martin', service: 'Dégradé classique', startsAt: '2026-10-25T13:30:00.000Z', timezone: 'Europe/Paris', durationMinutes: 30, priceCents: 500, appointmentId: 'demo-123' };
const samples = [
  ['01-verification', 'verify-email', { url: 'https://cutlyt.netlify.app/account.html?verifyEmail=EXEMPLE' }],
  ['02-bienvenue', 'welcome', {}],
  ['03-mot-de-passe', 'password-reset', { url: 'https://cutlyt.netlify.app/account.html?resetPassword=EXEMPLE' }],
  ['04-demande-recue', 'booking_requested:client', {}],
  ['05-demande-thomas', 'booking_requested:admin', {}],
  ['06-confirmation', 'appointment_status:CONFIRMED', {}],
  ['07-refus', 'appointment_status:REJECTED', {}],
  ['08-annulation', 'appointment_cancelled', {}],
  ['09-annulation-demande', 'cancellation_received:demo', {}],
  ['10-annulation-acceptee', 'cancellation_ACCEPTED', { decision: 'ACCEPTED' }],
  ['11-annulation-refusee', 'cancellation_REJECTED', { decision: 'REJECTED' }],
  ['12-rappel-24h', 'reminder:24h:v1', {}],
  ['13-rappel-2h', 'reminder:2h:v1', {}]
];
const index = [];
for (const [name, kind, extra] of samples) {
  const mail = renderEmail(kind, { ...base, ...extra }, { recipient: 'sarah@example.org' });
  fs.writeFileSync(path.join(out, `${name}.html`), mail.html.replace('https://cutlyt.netlify.app/email/banner.jpg', banner));
  fs.writeFileSync(path.join(out, `${name}.txt`), `Objet : ${mail.subject}\n\n${mail.text}\n`);
  index.push(`<li><a href="${name}.html">${name}</a> — ${mail.subject}</li>`);
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Aperçus e-mails CUTLY</title><ul style="font:16px/1.8 sans-serif">${index.join('')}</ul>`);
console.log(`${samples.length} aperçus écrits dans ${out}`);
