// Modèles d'e-mails CUTLY : HTML robuste (tableaux, styles en ligne, repli Outlook, mode sombre, mobile) + texte brut.
// Identité : ciel et mer de la page d'accueil (bannière du Nokia sur la plage), encre et papier de l'interface,
// Instrument Serif en tête quand le client l'accepte, Georgia sinon. Aucune animation, aucun effet de verre.
// Le contenu ne dépend jamais des images : le bandeau a une couleur de repli et un texte alternatif.

const PALETTE = {
  paper: '#f4f2ed', ink: '#111110', ink2: '#3a3936', muted: '#6c6b66', line: '#d9d6cd',
  sky: '#cfe3f3', skySoft: '#e5eef7', sea: '#0861c4', ok: '#2c6a45', warn: '#86570f', danger: '#a3382d'
};
const SERIF = "'Instrument Serif', Georgia, 'Times New Roman', serif";
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function baseUrl() {
  const raw = process.env.CUTLY_PUBLIC_BASE_URL;
  try { const url = new URL(raw); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.origin; } catch { /* repli ci-dessous */ }
  return process.env.NODE_ENV === 'production' ? 'https://cutlyt.netlify.app' : 'http://127.0.0.1:3000';
}
const absolute = path => new URL(path, baseUrl()).toString();

// Dates à la française : « dimanche 25 octobre », « 14h30 ».
function frenchDate(iso, timezone = 'Europe/Paris') {
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) return '';
  const text = new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
function frenchTime(iso, timezone = 'Europe/Paris') {
  const date = new Date(iso); if (!Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.hour}h${parts.minute}`;
}
const euros = cents => (Number.isSafeInteger(cents) ? (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }) : '');

// ---------- Gabarit ----------
function layout({ preheader, title, paragraphs = [], details = [], status = null, button = null, note = '', recipient = '' }) {
  const h = escapeHtml;
  const toneColor = { ok: PALETTE.ok, warn: PALETTE.warn, danger: PALETTE.danger, info: PALETTE.sea }[status?.tone] || PALETTE.ink2;
  const paragraphHtml = paragraphs.map(p => `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${PALETTE.ink2};" class="ink2">${p.html ?? h(p)}</p>`).join('');
  const statusHtml = status ? `<p style="margin:0 0 20px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1.4;color:${toneColor};"><span style="font-size:13px;">&#9679;</span>&nbsp; ${h(status.label)}</p>` : '';
  const detailsHtml = details.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;border-top:1px solid ${PALETTE.line};" class="rule">${details.map(([label, value]) => `<tr><td class="rule" style="padding:11px 0;border-bottom:1px solid ${PALETTE.line};font-family:${SANS};font-size:14px;color:${PALETTE.muted};" width="38%">${h(label)}</td><td class="ink rule" align="right" style="padding:11px 0;border-bottom:1px solid ${PALETTE.line};font-family:${SANS};font-size:16px;font-weight:600;color:${PALETTE.ink};">${h(value)}</td></tr>`).join('')}</table>` : '';
  const buttonHtml = button ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;"><tr><td bgcolor="${PALETTE.ink}" style="background-color:${PALETTE.ink};border-radius:8px;" class="btn"><a href="${h(button.url)}" target="_blank" style="display:inline-block;padding:15px 28px;font-family:${SANS};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;" class="btn-text">${h(button.label)}</a></td></tr></table>` : '';
  const noteHtml = note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;"><tr><td bgcolor="${PALETTE.skySoft}" class="sky-soft" style="background-color:${PALETTE.skySoft};border-left:3px solid ${PALETTE.sea};padding:14px 16px;font-family:${SANS};font-size:14px;line-height:1.55;color:${PALETTE.ink2};">${note.html ?? h(note)}</td></tr></table>` : '';
  const fallbackLink = button ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.5;color:${PALETTE.muted};">Si le bouton ne s’affiche pas, copiez ce lien dans votre navigateur :<br><a href="${h(button.url)}" style="color:${PALETTE.sea};word-break:break-all;">${h(button.url)}</a></p>` : '';

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${h(title)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table,td{mso-table-lspace:0;mso-table-rspace:0}
  img{-ms-interpolation-mode:bicubic;border:0;outline:none;text-decoration:none;display:block}
  a{color:${PALETTE.sea}}
  @media only screen and (max-width:620px){
    .container{width:100%!important}
    .pad{padding-left:22px!important;padding-right:22px!important}
    .h1{font-size:28px!important;line-height:1.12!important}
    .banner{width:100%!important;height:auto!important}
  }
  @media (prefers-color-scheme:dark){
    .bg-outer,.bg-paper{background-color:#0d1013!important}
    .ink,.h1{color:#f4f2ed!important}
    .ink2{color:#cfccc4!important}
    .muted{color:#a3a19a!important}
    .rule{border-color:#2a2e33!important}
    .sky-soft{background-color:#14202c!important;color:#d6e4f2!important}
    .btn{background-color:#f4f2ed!important}
    .btn-text{color:#111110!important}
    a{color:#7fb6ee}
  }
</style>
</head>
<body class="bg-outer" style="margin:0;padding:0;background-color:${PALETTE.paper};" bgcolor="${PALETTE.paper}">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${h(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-outer" bgcolor="${PALETTE.paper}" style="background-color:${PALETTE.paper};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="container bg-paper" bgcolor="${PALETTE.paper}" style="width:600px;max-width:600px;background-color:${PALETTE.paper};">
  <tr><td class="pad" style="padding:6px 36px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-family:${SERIF};font-size:30px;line-height:1;letter-spacing:.01em;color:${PALETTE.ink};" class="ink"><a href="${h(absolute('/'))}" style="color:${PALETTE.ink};text-decoration:none;" class="ink">CUTLY</a></td>
      <td align="right" style="font-family:${SANS};font-size:12px;line-height:1.4;color:${PALETTE.muted};" class="muted">Thomas Shop<br>Boulogne-Billancourt</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${PALETTE.sky}" style="background-color:${PALETTE.sky};font-size:0;line-height:0;">
    <img src="${h(absolute('/email/banner.jpg'))}" width="600" height="200" alt="CUTLY — un Nokia sur la plage, entre ciel et mer" class="banner" style="width:600px;max-width:100%;height:auto;font-family:${SERIF};font-size:18px;line-height:28px;color:${PALETTE.sea};text-align:center;">
  </td></tr>
  <tr><td class="pad" style="padding:34px 36px 12px;">
    <h1 class="h1 ink" style="margin:0 0 22px;font-family:${SERIF};font-weight:400;font-size:34px;line-height:1.1;color:${PALETTE.ink};">${h(title)}</h1>
    ${statusHtml}${paragraphHtml}${detailsHtml}${buttonHtml}${noteHtml}
  </td></tr>
  <tr><td class="pad" style="padding:8px 36px 6px;">${fallbackLink}</td></tr>
  <tr><td class="pad" style="padding:22px 36px 30px;border-top:1px solid ${PALETTE.line};" >
    <p class="muted" style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.6;color:${PALETTE.muted};">CUTLY — réservation pour Thomas Shop, Boulogne-Billancourt. Paiement sur place.</p>
    ${recipient ? `<p class="muted" style="margin:0 0 6px;font-family:${SANS};font-size:12px;line-height:1.6;color:${PALETTE.muted};">Cet e-mail a été envoyé à ${h(recipient)}.</p>` : ''}
    <p class="muted" style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${PALETTE.muted};"><a href="${h(absolute('/terms.html'))}" style="color:${PALETTE.muted};">Conditions générales</a> &nbsp;·&nbsp; <a href="${h(absolute('/privacy.html'))}" style="color:${PALETTE.muted};">Confidentialité</a> &nbsp;·&nbsp; <a href="${h(absolute('/cancellation.html'))}" style="color:${PALETTE.muted};">Annulation</a></p>
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

function plainText({ title, paragraphs = [], details = [], status = null, button = null, note = '', recipient = '' }) {
  const strip = value => (value?.text ?? value?.html?.replace(/<[^>]+>/g, '') ?? value ?? '');
  const lines = [`CUTLY — Thomas Shop, Boulogne-Billancourt`, '', title.toUpperCase(), ''];
  if (status) lines.push(`Statut : ${status.label}`, '');
  for (const p of paragraphs) lines.push(strip(p), '');
  if (details.length) { for (const [label, value] of details) lines.push(`${label} : ${value}`); lines.push(''); }
  if (button) lines.push(`${button.label} : ${button.url}`, '');
  if (note) lines.push(strip(note), '');
  lines.push('—', 'CUTLY — réservation pour Thomas Shop. Paiement sur place.');
  if (recipient) lines.push(`Cet e-mail a été envoyé à ${recipient}.`);
  lines.push(`Conditions générales : ${absolute('/terms.html')}`, `Confidentialité : ${absolute('/privacy.html')}`);
  return lines.join('\n');
}

// ---------- Contenu par événement ----------
function hello(data) { return data.firstName ? `Bonjour ${data.firstName},` : 'Bonjour,'; }
function appointmentDetails(data, { price = true } = {}) {
  const rows = [['Prestation', data.service], ['Date', frenchDate(data.startsAt, data.timezone)], ['Heure', frenchTime(data.startsAt, data.timezone)]];
  if (Number.isFinite(data.durationMinutes)) rows.push(['Durée', `${data.durationMinutes} minutes`]);
  if (price && euros(data.priceCents)) rows.push(['Prix', `${euros(data.priceCents)} · paiement sur place`]);
  rows.push(['Professionnel', 'Thomas · Thomas Shop']);
  return rows.filter(([, value]) => value);
}
const appointmentUrl = data => (data.appointmentId ? absolute(`/appointment.html?id=${encodeURIComponent(data.appointmentId)}`) : absolute('/appointments.html'));
const whenLine = data => `${frenchDate(data.startsAt, data.timezone).toLowerCase()} à ${frenchTime(data.startsAt, data.timezone)}`;

const BUILDERS = {
  'verify-email': data => ({
    subject: 'Confirmez votre adresse e-mail — CUTLY', preheader: 'Un clic pour activer votre compte CUTLY.', title: 'Confirmez votre adresse e-mail',
    paragraphs: [hello(data), 'Merci de votre inscription chez CUTLY. Pour activer votre compte et pouvoir réserver chez Thomas Shop, confirmez que cette adresse e-mail est bien la vôtre.'],
    button: { label: 'Vérifier mon e-mail', url: data.url },
    note: `Ce lien est valable ${data.expiresMinutes || 30} minutes et ne peut servir qu’une seule fois. Si vous n’êtes pas à l’origine de cette inscription, ignorez simplement ce message : aucun compte ne sera activé.`
  }),
  'password-reset': data => ({
    subject: 'Réinitialisez votre mot de passe CUTLY', preheader: 'Choisissez un nouveau mot de passe CUTLY.', title: 'Réinitialisez votre mot de passe',
    paragraphs: [hello(data), 'Vous avez demandé à choisir un nouveau mot de passe pour votre compte CUTLY. Le lien ci-dessous vous permet de le faire en toute sécurité.'],
    button: { label: 'Choisir un nouveau mot de passe', url: data.url },
    note: `Ce lien est valable ${data.expiresMinutes || 30} minutes et ne fonctionne qu’une seule fois. Si vous n’avez pas fait cette demande, ne cliquez pas : votre mot de passe actuel reste inchangé. CUTLY ne vous demandera jamais votre mot de passe par e-mail.`
  }),
  welcome: data => ({
    subject: 'Bienvenue chez CUTLY', preheader: 'Votre compte est actif : réservez votre prochaine coupe.', title: 'Bienvenue chez CUTLY',
    paragraphs: [hello(data), 'Votre adresse e-mail est confirmée et votre compte est actif.', 'CUTLY est la réservation de Thomas Shop, à Boulogne-Billancourt : vous choisissez une prestation, un jour, un horaire, et Thomas valide votre demande. Le paiement se fait sur place.',
      'Tous vos rendez-vous, à venir comme passés, se retrouvent dans « Mes rendez-vous ».'],
    button: { label: 'Réserver une coupe', url: absolute('/booking.html') }
  }),
  'booking_requested:client': data => ({
    subject: 'Votre demande de rendez-vous a été reçue — CUTLY', preheader: `${data.service} · ${whenLine(data)} — en attente de validation par Thomas.`, title: 'Demande reçue',
    status: { label: 'En attente de validation par Thomas', tone: 'warn' },
    paragraphs: [hello(data), { html: `Votre demande de rendez-vous pour un <strong>${escapeHtml(data.service)}</strong> chez Thomas Shop a bien été reçue pour le ${escapeHtml(whenLine(data))}.`, text: `Votre demande de rendez-vous pour un ${data.service} chez Thomas Shop a bien été reçue pour le ${whenLine(data)}.` },
      'Votre rendez-vous n’est pas encore confirmé : il est en attente de validation par Thomas. Le créneau vous est réservé le temps de sa réponse, et vous recevrez un nouvel e-mail dès qu’il aura répondu.'],
    details: appointmentDetails(data), button: { label: 'Voir ma demande', url: appointmentUrl(data) }
  }),
  'booking_requested:admin': data => ({
    subject: 'Nouvelle demande de rendez-vous — CUTLY', preheader: `${data.clientName || 'Un client'} · ${data.service} · ${whenLine(data)}`, title: 'Nouvelle demande à traiter',
    status: { label: 'En attente de votre décision', tone: 'warn' },
    paragraphs: ['Bonjour Thomas,', { html: `${escapeHtml(data.clientName || 'Un client')} demande un <strong>${escapeHtml(data.service)}</strong> le ${escapeHtml(whenLine(data))}.`, text: `${data.clientName || 'Un client'} demande un ${data.service} le ${whenLine(data)}.` }],
    details: [...(data.clientName ? [['Client', data.clientName]] : []), ...appointmentDetails(data)], button: { label: 'Ouvrir l’administration', url: absolute('/admin.html') }
  }),
  'status:CONFIRMED': data => ({
    subject: 'Votre rendez-vous est confirmé — CUTLY', preheader: `Confirmé : ${data.service}, ${whenLine(data)}.`, title: 'Rendez-vous confirmé',
    status: { label: 'Confirmé par Thomas', tone: 'ok' },
    paragraphs: [hello(data), { html: `Thomas a accepté votre demande : votre rendez-vous pour un <strong>${escapeHtml(data.service)}</strong> est confirmé le ${escapeHtml(whenLine(data))}.`, text: `Thomas a accepté votre demande : votre rendez-vous pour un ${data.service} est confirmé le ${whenLine(data)}.` }, 'Vous recevrez un rappel 24 heures puis 2 heures avant.'],
    details: [['Client', data.clientName], ...appointmentDetails(data)].filter(([, value]) => value), button: { label: 'Voir mon rendez-vous', url: appointmentUrl(data) }
  }),
  'status:REJECTED': data => ({
    subject: 'Mise à jour de votre demande — CUTLY', preheader: 'Votre demande n’a pas pu être acceptée : choisissez un autre créneau.', title: 'Votre demande n’a pas pu être acceptée',
    status: { label: 'Demande non acceptée', tone: 'danger' },
    paragraphs: [hello(data), { html: `Merci pour votre demande de <strong>${escapeHtml(data.service)}</strong> le ${escapeHtml(whenLine(data))}. Thomas n’est malheureusement pas en mesure de l’accepter sur ce créneau.`, text: `Merci pour votre demande de ${data.service} le ${whenLine(data)}. Thomas n’est malheureusement pas en mesure de l’accepter sur ce créneau.` },
      'Le créneau est de nouveau libre et rien n’est dû. Vous pouvez en choisir un autre en quelques secondes.'],
    button: { label: 'Choisir un autre créneau', url: absolute('/booking.html') }
  }),
  'status:CANCELLED': data => cancelledMail(data),
  appointment_cancelled: data => cancelledMail(data),
  'cancellation_received:client': data => ({
    subject: 'Votre demande d’annulation a été reçue — CUTLY', preheader: 'Votre rendez-vous reste actif jusqu’à la réponse de Thomas.', title: 'Demande d’annulation reçue',
    status: { label: 'En attente de la décision de Thomas', tone: 'warn' },
    paragraphs: [hello(data), 'Votre rendez-vous a lieu dans moins de 24 heures : l’annulation doit donc être validée par Thomas.', { html: '<strong>Votre rendez-vous reste actif</strong> tant que Thomas n’a pas répondu. Nous vous écrirons dès qu’il aura décidé.', text: 'Votre rendez-vous reste actif tant que Thomas n’a pas répondu. Nous vous écrirons dès qu’il aura décidé.' }],
    details: appointmentDetails(data, { price: false }), button: { label: 'Voir mon rendez-vous', url: appointmentUrl(data) }
  }),
  'cancellation_decision:ACCEPTED': data => cancelledMail(data, true),
  'cancellation_decision:REJECTED': data => ({
    subject: 'Votre rendez-vous est maintenu — CUTLY', preheader: 'Thomas n’a pas pu accepter l’annulation : votre rendez-vous reste prévu.', title: 'Votre rendez-vous est maintenu',
    status: { label: 'Annulation non acceptée — rendez-vous maintenu', tone: 'info' },
    paragraphs: [hello(data), 'Thomas n’a pas pu accepter votre demande d’annulation : votre rendez-vous reste confirmé aux horaires ci-dessous.'],
    details: appointmentDetails(data), button: { label: 'Voir mon rendez-vous', url: appointmentUrl(data) }
  }),
  'cancellation_requested:admin': data => ({
    subject: 'Demande d’annulation à traiter — CUTLY', preheader: 'Un client demande l’annulation d’un rendez-vous dans moins de 24 heures.', title: 'Demande d’annulation à traiter',
    status: { label: 'En attente de votre décision', tone: 'warn' },
    paragraphs: ['Bonjour Thomas,', 'Un client demande l’annulation d’un rendez-vous prévu dans moins de 24 heures. Le rendez-vous reste actif jusqu’à votre décision.'],
    details: [...(data.clientName ? [['Client', data.clientName]] : []), ...appointmentDetails(data, { price: false })], button: { label: 'Ouvrir l’administration', url: absolute('/admin.html') }
  }),
  'reminder:24h': data => reminder(data, 'Rappel : votre rendez-vous est demain', 'Rappel — rendez-vous demain', 'Votre rendez-vous a lieu dans environ 24 heures.'),
  'reminder:2h': data => reminder(data, 'Rappel : votre rendez-vous est dans 2 heures', 'Rappel — rendez-vous dans 2 heures', 'Votre rendez-vous a lieu dans environ 2 heures.'),
  appointment_modified: data => ({
    subject: 'Votre rendez-vous a été modifié — CUTLY', preheader: `Nouveau créneau : ${whenLine(data)}.`, title: 'Votre rendez-vous a été modifié',
    status: { label: 'Nouveau créneau', tone: 'info' },
    paragraphs: [hello(data), 'Thomas a modifié l’horaire de votre rendez-vous. Voici le nouveau créneau.'],
    details: appointmentDetails(data), button: { label: 'Voir mon rendez-vous', url: appointmentUrl(data) }
  })
};
function cancelledMail(data, afterRequest = false) {
  return {
    subject: afterRequest ? 'Votre annulation est confirmée — CUTLY' : 'Votre rendez-vous a été annulé — CUTLY', preheader: 'Votre rendez-vous est annulé. Vous pouvez réserver à nouveau quand vous voulez.', title: 'Rendez-vous annulé',
    status: { label: 'Annulé', tone: 'danger' },
    paragraphs: [hello(data), afterRequest ? 'Thomas a accepté votre demande d’annulation : votre rendez-vous est annulé.' : 'Votre rendez-vous est annulé. Le créneau est de nouveau libre.', 'Vous pouvez réserver à nouveau quand vous le souhaitez.'],
    details: appointmentDetails(data, { price: false }), button: { label: 'Réserver à nouveau', url: absolute('/booking.html') }
  };
}
function reminder(data, subject, title, lead) {
  return {
    subject: `${subject} — CUTLY`, preheader: `${data.service} · ${whenLine(data)}.`, title, status: { label: 'Confirmé', tone: 'ok' },
    paragraphs: [hello(data), lead], details: appointmentDetails(data), button: { label: 'Voir mon rendez-vous', url: appointmentUrl(data) },
    note: 'Un empêchement ? Vous pouvez annuler depuis « Mes rendez-vous » : plus de 24 heures avant, directement ; ensuite, Thomas doit valider.'
  };
}

// Classe un type d'outbox en modèle. Renvoie null pour un type inconnu, { skip:true } si aucun e-mail ne doit partir.
function resolveTemplate(kind, payload = {}) {
  if (kind === 'verify-email' || kind === 'password-reset' || kind === 'welcome' || kind === 'booking_requested:client' || kind === 'booking_requested:admin' || kind === 'appointment_cancelled' || kind === 'cancellation_requested' || kind === 'cancellation_requested:admin') {
    return kind === 'cancellation_requested' ? 'cancellation_requested:admin' : kind;
  }
  if (kind.startsWith('appointment_status:')) { const status = kind.split(':')[1]; return ['CONFIRMED', 'REJECTED', 'CANCELLED'].includes(status) ? `status:${status}` : { skip: true }; }
  if (kind.startsWith('cancellation_received')) return 'cancellation_received:client';
  if (kind.startsWith('cancellation_')) return payload.decision === 'ACCEPTED' ? 'cancellation_decision:ACCEPTED' : 'cancellation_decision:REJECTED';
  if (kind.startsWith('reminder:')) return `reminder:${kind.split(':')[1]}`;
  if (kind.startsWith('appointment_modified:')) return 'appointment_modified';
  return null;
}

// data : { firstName, clientName, service, startsAt, timezone, durationMinutes, priceCents, appointmentId, url, expiresMinutes }
function renderEmail(kind, data = {}, { recipient = '' } = {}) {
  const key = resolveTemplate(kind, data);
  if (key && typeof key === 'object') return key;
  const builder = key && BUILDERS[key];
  if (!builder) return null;
  const content = builder({ timezone: 'Europe/Paris', ...data });
  const html = layout({ ...content, recipient });
  return { subject: content.subject, html, text: plainText({ ...content, recipient }), preheader: content.preheader, template: key };
}

module.exports = { renderEmail, resolveTemplate, frenchDate, frenchTime, escapeHtml, PALETTE, TEMPLATE_KEYS: Object.keys(BUILDERS) };
