// Système de notifications e-mail : modèles, file d'envoi, états, anti-doublons, pannes, rebonds, webhooks.
// Ces tests utilisent un transport simulé : ils prouvent la logique de CUTLY, pas la livraison réelle par Resend.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cutly-notifications-'));
Object.assign(process.env, {
  NODE_ENV: 'test', CUTLY_DB_PATH: path.join(tempDir, 'cutly.sqlite'), CUTLY_MFA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('base64'),
  CUTLY_PUBLIC_BASE_URL: 'https://cutly.test'
});
for (const key of ['CUTLY_DATABASE_URL', 'DATABASE_URL', 'NETLIFY_DB_URL', 'NETLIFY']) delete process.env[key];

const { db, databaseReady } = require('../server');
const { renderEmail, TEMPLATE_KEYS } = require('../lib/email-templates');
const { processOutbox, enqueueEmail, enqueueAccountEmail, verifyWebhookSignature, applyProviderEvent, template } = require('../lib/notifications');
const { providerStatus, fileTransport, classifyEmailFailure } = require('../lib/providers');

after(async () => { await db.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });

const START = '2030-10-26T12:30:00.000Z'; // samedi 26 octobre 2030, 14h30 à Paris (UTC+2)
const NOW = new Date('2030-10-20T10:00:00.000Z');
let counter = 0;

async function appointment(status = 'PENDING', patch = {}) {
  await databaseReady;
  const id = `notif-appt-${++counter}`, userId = `notif-user-${counter}`, hour = 8 + counter; // créneaux distincts, jamais de chevauchement
  const startsAt = `2030-11-${String(10 + counter).padStart(2, '0')}T0${hour % 10}:00:00.000Z`;
  await db.prepare("INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'CLIENT',?,?)")
    .run(userId, `client${counter}@example.org`, `+3360000${String(counter).padStart(4, '0')}`, patch.firstName || 'Sarah', 'Test', 'x', NOW.toISOString(), NOW.toISOString(), NOW.toISOString());
  await db.prepare("INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,client_user_id,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, 'thomas-shop', 'degrade-classique', 'Sarah Test', `client${counter}@example.org`, startsAt, new Date(Date.parse(startsAt) + 1800000).toISOString(), 'Europe/Paris', 'Dégradé classique', 500, 30, userId, status, NOW.toISOString());
  return { id, userId, email: `client${counter}@example.org`, startsAt };
}
const queue = (kind, appt, payload = {}) => enqueueEmail(db, { kind, to: appt.email, appointmentId: appt.id, payload: { appointmentId: appt.id, ...payload }, now: new Date('2030-10-01T00:00:00Z') });
const outboxRow = id => db.prepare('SELECT * FROM notification_outbox WHERE id=?').get(id);

test('chaque modèle produit un objet, un HTML structuré, une version texte et des liens absolus HTTPS', () => {
  const data = { firstName: 'Sarah', clientName: 'Sarah Test', service: 'Dégradé classique', startsAt: START, timezone: 'Europe/Paris', durationMinutes: 30, priceCents: 500, appointmentId: 'abc', url: 'https://cutly.test/account.html?verifyEmail=tok' };
  const kinds = ['verify-email', 'password-reset', 'welcome', 'booking_requested:client', 'booking_requested:admin', 'appointment_status:CONFIRMED', 'appointment_status:REJECTED', 'appointment_status:CANCELLED',
    'appointment_cancelled', 'cancellation_received:abc', 'cancellation_ACCEPTED', 'cancellation_REJECTED', 'cancellation_requested', 'reminder:24h:v1', 'reminder:2h:v1', 'appointment_modified:2'];
  const payloads = { cancellation_ACCEPTED: { decision: 'ACCEPTED' }, cancellation_REJECTED: { decision: 'REJECTED' } };
  const subjects = new Set();
  for (const kind of kinds) {
    const mail = renderEmail(kind, { ...data, ...(payloads[kind] || {}) }, { recipient: 'sarah@example.org' });
    assert.ok(mail && !mail.skip, `${kind} rendered`);
    subjects.add(mail.subject);
    assert.match(mail.subject, /CUTLY/);
    assert.match(mail.html, /<html lang="fr"/);
    assert.match(mail.html, /name="color-scheme" content="light dark"/);
    assert.match(mail.html, /prefers-color-scheme:dark/);
    assert.match(mail.html, /<img src="https:\/\/cutly\.test\/email\/banner\.jpg"[^>]*alt="[^"]+"/, `${kind} banner has alt text`);
    assert.ok(mail.text.length > 80 && !/<[a-z]/.test(mail.text), `${kind} has a plain-text version`);
    for (const [, href] of mail.html.matchAll(/href="([^"]+)"/g)) assert.match(href, /^https:\/\/cutly\.test\//, `${kind} link ${href} is absolute and secure`);
    assert.doesNotMatch(mail.html, /javascript:|<script/i);
  }
  assert.ok(subjects.size >= 12, 'subjects are specific to each event');
  assert.equal(TEMPLATE_KEYS.length >= 14, true);
});

test('les objets imposés et le contenu personnalisé respectent la demande', () => {
  const base = { firstName: 'Sarah', service: 'Dégradé classique', startsAt: START, timezone: 'Europe/Paris', durationMinutes: 30, priceCents: 500, appointmentId: 'abc', url: 'https://cutly.test/x' };
  const subject = (kind, extra) => renderEmail(kind, { ...base, ...extra }).subject;
  assert.equal(subject('verify-email'), 'Confirmez votre adresse e-mail — CUTLY');
  assert.equal(subject('password-reset'), 'Réinitialisez votre mot de passe CUTLY');
  assert.equal(subject('welcome'), 'Bienvenue chez CUTLY');
  assert.equal(subject('booking_requested:client'), 'Votre demande de rendez-vous a été reçue — CUTLY');
  assert.equal(subject('appointment_status:CONFIRMED'), 'Votre rendez-vous est confirmé — CUTLY');
  assert.equal(subject('appointment_status:REJECTED'), 'Mise à jour de votre demande — CUTLY');
  const pending = renderEmail('booking_requested:client', base);
  assert.match(pending.text, /Bonjour Sarah,/);
  assert.match(pending.text, /Dégradé classique/);
  assert.match(pending.text, /Samedi 26 octobre/);
  assert.match(pending.text, /14h30/);
  assert.match(pending.text, /30 minutes/);
  assert.match(pending.text, /5,00/);
  assert.match(pending.text, /en attente de validation par Thomas/i);
  // Le mot « confirmé » n'apparaît que dans la négation « n'est pas encore confirmé » : jamais comme affirmation.
  assert.doesNotMatch((pending.html + pending.text + pending.subject).replace(/pas encore confirmé/g, ''), /confirmé/i, 'une demande en attente n’est jamais annoncée comme confirmée');
  const confirmed = renderEmail('appointment_status:CONFIRMED', base);
  assert.match(confirmed.html, /Confirmé par Thomas/);
  assert.match(confirmed.html, /Voir mon rendez-vous/);
  assert.match(confirmed.html, /appointment\.html\?id=abc/);
  const refused = renderEmail('appointment_status:REJECTED', base);
  assert.match(refused.html, /Choisir un autre créneau/);
  assert.doesNotMatch(refused.text, /est confirmé/);
  // Aucune adresse inventée, aucune donnée sensible inutile.
  for (const mail of [pending, confirmed, refused]) assert.doesNotMatch(mail.html + mail.text, /Île Seguin|rue |\+33|mot de passe est/i);
});

test('les liens de vérification et de réinitialisation expliquent la durée, l’usage unique et la consigne de sécurité', () => {
  const verify = renderEmail('verify-email', { firstName: 'Sarah', url: 'https://cutly.test/account.html?verifyEmail=tok' });
  assert.match(verify.text, /30 minutes/);
  assert.match(verify.text, /une seule fois/);
  assert.match(verify.text, /ignorez simplement ce message/);
  assert.match(verify.html, /Vérifier mon e-mail/);
  const reset = renderEmail('password-reset', { firstName: 'Sarah', url: 'https://cutly.test/account.html?resetPassword=tok' });
  assert.match(reset.text, /n’avez pas fait cette demande/);
  assert.match(reset.text, /ne vous demandera jamais votre mot de passe/);
  assert.doesNotMatch(reset.text + reset.html, /mot de passe temporaire/i);
});

test('annulation tardive : demande reçue, puis décision — jamais d’annulation annoncée avant la décision', () => {
  const base = { firstName: 'Sarah', service: 'Dégradé classique', startsAt: START, timezone: 'Europe/Paris', appointmentId: 'abc' };
  const received = renderEmail('cancellation_received:abc', base);
  assert.match(received.text, /reste actif/);
  assert.doesNotMatch(received.subject + received.text, /est annulé|annulation est confirmée/i);
  assert.match(renderEmail('cancellation_ACCEPTED', { ...base, decision: 'ACCEPTED' }).subject, /annulation est confirmée/);
  assert.match(renderEmail('cancellation_REJECTED', { ...base, decision: 'REJECTED' }).subject, /rendez-vous est maintenu/);
});

test('le contenu dynamique est échappé (pas d’injection HTML par un prénom ou une prestation)', () => {
  const mail = renderEmail('booking_requested:client', { firstName: '<img src=x onerror=alert(1)>', service: '"><script>alert(1)</script>', startsAt: START, timezone: 'Europe/Paris' });
  assert.doesNotMatch(mail.html, /<img src=x|<script>alert/);
  assert.match(mail.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('l’heure est celle de Paris, y compris autour du changement d’heure (UTC+1 en hiver, UTC+2 en été)', () => {
  const winter = renderEmail('booking_requested:client', { service: 'Taper', startsAt: '2030-12-14T08:00:00.000Z', timezone: 'Europe/Paris' });
  assert.match(winter.text, /09h00/);
  const summer = renderEmail('booking_requested:client', { service: 'Taper', startsAt: '2030-07-13T07:00:00.000Z', timezone: 'Europe/Paris' });
  assert.match(summer.text, /09h00/);
});

test('un e-mail de compte n’est mis en file qu’une seule fois (idempotence) et son lien disparaît après l’envoi', async () => {
  await databaseReady;
  const first = await enqueueAccountEmail(db, { kind: 'verify-email', to: 'Nouveau@Example.org', token: 'a'.repeat(43), firstName: 'Nina', idempotencyKey: 'client-verification:abc', now: NOW });
  const again = await enqueueAccountEmail(db, { kind: 'verify-email', to: 'nouveau@example.org', token: 'b'.repeat(43), firstName: 'Nina', idempotencyKey: 'client-verification:abc', now: NOW });
  assert.equal(first.queued, true);
  assert.equal(again.queued, false, 'même clé = pas de second message');
  const row = await outboxRow(first.id);
  assert.match(row.payload_json, /verifyEmail=a{43}/);
  assert.equal(JSON.parse(row.payload_json).email, 'nouveau@example.org');
  const sent = [];
  await processOutbox(db, { now: NOW, limit: 50, deliver: async message => { sent.push(message); return { provider: 'test-double', id: `msg-${sent.length}`, status: 'ACCEPTED' }; } });
  const mine = sent.find(message => message.to === 'nouveau@example.org');
  assert.ok(mine && mine.html.includes('verifyEmail=' + 'a'.repeat(43)), 'le lien est bien dans le message envoyé');
  const after = await outboxRow(first.id);
  assert.equal(after.status, 'SENT');
  assert.doesNotMatch(after.payload_json, /verifyEmail|url|token/, 'le lien à usage unique ne reste pas en base');
  assert.equal(JSON.parse(after.payload_json).firstName, 'Nina');
});

test('états : accepté, puis livré ; jamais « livré » parce que l’envoi a répondu', async () => {
  const appt = await appointment('PENDING');
  const row = await queue('booking_requested:client', appt);
  assert.equal((await outboxRow(row.id)).status, 'PENDING');
  await processOutbox(db, { now: NOW, limit: 50, deliver: async () => ({ provider: 'resend', id: 'prov-1', status: 'ACCEPTED' }) });
  const accepted = await outboxRow(row.id);
  assert.deepEqual([accepted.status, accepted.provider_status], ['SENT', 'ACCEPTED']);
  const delivered = await applyProviderEvent(db, { eventId: 'evt-1', type: 'email.delivered', messageId: 'prov-1', now: NOW });
  assert.equal(delivered.status, 'DELIVERED');
  assert.equal((await outboxRow(row.id)).provider_status, 'DELIVERED');
  assert.deepEqual(await applyProviderEvent(db, { eventId: 'evt-1', type: 'email.delivered', messageId: 'prov-1', now: NOW }), { duplicate: true });
  await applyProviderEvent(db, { eventId: 'evt-2', type: 'email.delivery_delayed', messageId: 'prov-1', now: NOW });
  assert.equal((await outboxRow(row.id)).provider_status, 'DELIVERED', 'un événement plus ancien ne fait pas reculer le statut');
});

test('une demande en attente ne produit jamais « confirmé » ; l’état réel gagne au moment de l’envoi', async () => {
  const appt = await appointment('PENDING');
  const requested = await queue('booking_requested:client', appt);
  const confirmed = await queue('appointment_status:CONFIRMED', appt);
  await db.prepare("UPDATE appointments SET status='CONFIRMED' WHERE id=?").run(appt.id);
  const sent = [];
  await processOutbox(db, { now: NOW, limit: 50, deliver: async message => { sent.push(message); return { provider: 'test-double', id: `m${sent.length}`, status: 'ACCEPTED' }; } });
  const mine = sent.filter(message => message.to === appt.email);
  assert.equal(mine.length, 1, 'seule la confirmation part');
  assert.match(mine[0].subject, /confirmé/);
  assert.equal((await outboxRow(requested.id)).status, 'OBSOLETE');
  assert.equal((await outboxRow(confirmed.id)).status, 'SENT');
});

test('un statut sans e-mail prévu (rendez-vous terminé) ne génère aucun message', async () => {
  const appt = await appointment('COMPLETED');
  const row = await queue('appointment_status:COMPLETED', appt);
  const sent = [];
  await processOutbox(db, { now: NOW, limit: 50, deliver: async message => { sent.push(message); return { id: 'x' }; } });
  assert.equal(sent.filter(message => message.to === appt.email).length, 0);
  assert.equal((await outboxRow(row.id)).status, 'OBSOLETE');
});

test('panne temporaire : nouvelle tentative plus tard, puis un seul envoi réussi (pas de doublon)', async () => {
  const appt = await appointment('PENDING');
  const row = await queue('booking_requested:client', appt);
  let calls = 0;
  const flaky = async () => { calls++; if (calls === 1) throw classifyEmailFailure(503, {}); return { provider: 'resend', id: 'prov-retry', status: 'ACCEPTED' }; };
  await processOutbox(db, { now: NOW, limit: 50, deliver: flaky });
  const failed = await outboxRow(row.id);
  assert.deepEqual([failed.status, failed.attempts, failed.last_error], ['RETRYING', 1, 'email_provider_unavailable_503']);
  assert.ok(Date.parse(failed.next_attempt_at) > NOW.getTime(), 'prochaine tentative programmée');
  await processOutbox(db, { now: new Date(NOW.getTime() + 20 * 60000), limit: 50, deliver: flaky });
  const recovered = await outboxRow(row.id);
  assert.deepEqual([recovered.status, recovered.attempts, recovered.provider_message_id], ['SENT', 2, 'prov-retry']);
  await processOutbox(db, { now: new Date(NOW.getTime() + 40 * 60000), limit: 50, deliver: flaky });
  assert.equal(calls, 2, 'aucun troisième envoi');
});

test('adresse refusée par le fournisseur : abandon immédiat, état « rejeté »', async () => {
  const appt = await appointment('PENDING');
  const row = await queue('booking_requested:client', appt);
  await processOutbox(db, { now: NOW, limit: 50, deliver: async () => { throw classifyEmailFailure(422, { message: 'Invalid `to` field' }); } });
  const rejected = await outboxRow(row.id);
  assert.deepEqual([rejected.status, rejected.provider_status, rejected.next_attempt_at], ['FAILED', 'REJECTED', null]);
});

test('clé ou domaine refusé : les messages attendent la configuration sans épuiser leurs tentatives', async () => {
  const appt = await appointment('PENDING');
  const row = await enqueueEmail(db, { kind: 'booking_requested:client', to: appt.email, appointmentId: appt.id, payload: { appointmentId: appt.id }, now: NOW });
  for (let i = 0; i < 7; i++) await processOutbox(db, { now: new Date(NOW.getTime() + i * 31 * 60000), limit: 50, deliver: async () => { throw classifyEmailFailure(400, { message: 'API key is invalid' }); } });
  const waiting = await outboxRow(row.id);
  assert.equal(waiting.status, 'RETRYING');
  assert.equal(waiting.last_error, 'email_provider_configuration_rejected');
  assert.ok(waiting.attempts <= 1, 'tentatives non consommées');
  // Une fois la clé corrigée, le message part.
  await processOutbox(db, { now: new Date(NOW.getTime() + 8 * 31 * 60000), limit: 50, deliver: async () => ({ provider: 'resend', id: 'prov-fixed', status: 'ACCEPTED' }) });
  assert.equal((await outboxRow(row.id)).status, 'SENT');
});

test('rebond définitif ou plainte : l’adresse est mise de côté et ne reçoit plus rien', async () => {
  const appt = await appointment('PENDING');
  const first = await queue('booking_requested:client', appt);
  await processOutbox(db, { now: NOW, limit: 50, deliver: async () => ({ provider: 'resend', id: 'prov-bounce', status: 'ACCEPTED' }) });
  await applyProviderEvent(db, { eventId: 'evt-bounce', type: 'email.bounced', messageId: 'prov-bounce', recipients: [appt.email], bounceType: 'Permanent', now: NOW });
  assert.equal((await outboxRow(first.id)).provider_status, 'BOUNCED');
  assert.ok(await db.prepare('SELECT 1 FROM email_suppressions WHERE email=?').get(appt.email));
  const next = await queue('appointment_status:REJECTED', appt);
  await db.prepare("UPDATE appointments SET status='REJECTED' WHERE id=?").run(appt.id);
  const sent = [];
  await processOutbox(db, { now: NOW, limit: 50, deliver: async message => { sent.push(message); return { id: 'x' }; } });
  assert.equal(sent.filter(message => message.to === appt.email).length, 0);
  const suppressed = await outboxRow(next.id);
  assert.deepEqual([suppressed.status, suppressed.provider_status], ['FAILED', 'SUPPRESSED']);
  // Un rebond temporaire, lui, ne bloque pas l’adresse.
  await applyProviderEvent(db, { eventId: 'evt-soft', type: 'email.bounced', messageId: 'none', recipients: ['soft@example.org'], bounceType: 'Transient', now: NOW });
  assert.equal(await db.prepare('SELECT 1 FROM email_suppressions WHERE email=?').get('soft@example.org'), undefined);
});

test('webhook : signature Svix valide, falsifiée, périmée ou absente', () => {
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64');
  const body = JSON.stringify({ type: 'email.delivered', data: { email_id: 'prov-1' } });
  const id = 'msg_123', timestamp = String(Math.floor(Date.now() / 1000));
  const sign = (value, key = secret) => 'v1,' + crypto.createHmac('sha256', Buffer.from(key.replace(/^whsec_/, ''), 'base64')).update(`${id}.${timestamp}.${value}`).digest('base64');
  assert.equal(verifyWebhookSignature({ secret, id, timestamp, signature: sign(body), body }), true);
  assert.equal(verifyWebhookSignature({ secret, id, timestamp, signature: `v1,invalide ${sign(body)}`, body }), true, 'plusieurs signatures acceptées');
  assert.equal(verifyWebhookSignature({ secret, id, timestamp, signature: sign(body), body: body + ' ' }), false, 'corps modifié');
  assert.equal(verifyWebhookSignature({ secret: 'whsec_' + crypto.randomBytes(24).toString('base64'), id, timestamp, signature: sign(body), body }), false, 'mauvais secret');
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  assert.equal(verifyWebhookSignature({ secret, id, timestamp: old, signature: sign(body), body }), false, 'rejeu trop ancien');
  assert.equal(verifyWebhookSignature({ secret, id, timestamp, signature: undefined, body }), false);
  assert.equal(verifyWebhookSignature({ secret: '', id, timestamp, signature: sign(body), body }), false);
});

test('le transport de test n’existe jamais en production ni sur Netlify', () => {
  const saved = { transport: process.env.CUTLY_EMAIL_TRANSPORT, env: process.env.NODE_ENV, netlify: process.env.NETLIFY };
  try {
    process.env.CUTLY_EMAIL_TRANSPORT = 'file';
    process.env.NODE_ENV = 'test'; assert.equal(fileTransport(), true);
    process.env.NODE_ENV = 'production'; assert.equal(fileTransport(), false);
    process.env.NODE_ENV = 'test'; process.env.NETLIFY = 'true'; assert.equal(fileTransport(), false);
  } finally {
    for (const [key, value] of [['CUTLY_EMAIL_TRANSPORT', saved.transport], ['NODE_ENV', saved.env], ['NETLIFY', saved.netlify]]) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
  assert.notEqual(providerStatus().email, undefined);
});

test('classification des erreurs du fournisseur', () => {
  assert.equal(classifyEmailFailure(400, { message: 'API key is invalid' }).configuration, true);
  assert.equal(classifyEmailFailure(403, { message: 'The domain is not verified' }).configuration, true);
  assert.equal(classifyEmailFailure(429, {}).permanent, false);
  assert.equal(classifyEmailFailure(500, {}).permanent, false);
  assert.equal(classifyEmailFailure(422, {}).permanent, true);
  const row = { channel: 'EMAIL', kind: 'welcome', payload_json: JSON.stringify({ email: 'a@example.org', firstName: 'A' }) };
  assert.match(template(row).subject, /Bienvenue/);
});

test('rappels 24 h et 2 h : programmés, envoyés à l’heure, jamais en double, abandonnés si annulé ou encore en attente', async () => {
  const { refreshAppointmentReminders } = require('../lib/notifications');
  const reminderMails = sent => sent.filter(message => /^Rappel/.test(message.subject));
  const run = async (at, email) => { const sent = []; await processOutbox(db, { now: at, limit: 50, deliver: async message => { sent.push(message); return { provider: 'test-double', id: `r${Math.random()}`, status: 'ACCEPTED' }; } }); return reminderMails(sent).filter(message => message.to === email); };

  const confirmed = await appointment('CONFIRMED');
  const row = await db.prepare('SELECT * FROM appointments WHERE id=?').get(confirmed.id);
  const start = Date.parse(row.starts_at);
  await refreshAppointmentReminders(db, row, { now: NOW });
  const queued = await db.prepare("SELECT kind,next_attempt_at,status FROM notification_outbox WHERE appointment_id=? AND kind LIKE 'reminder:%' ORDER BY kind").all(confirmed.id);
  assert.equal(queued.length, 2);
  assert.deepEqual(queued.map(item => item.status), ['PENDING', 'PENDING']);
  assert.equal(Date.parse(queued.find(item => item.kind.startsWith('reminder:24h')).next_attempt_at), start - 24 * 3600000);
  assert.equal(Date.parse(queued.find(item => item.kind.startsWith('reminder:2h')).next_attempt_at), start - 2 * 3600000);
  await refreshAppointmentReminders(db, row, { now: NOW });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE appointment_id=? AND kind LIKE 'reminder:%'").get(confirmed.id)).n, 2, 'reprogrammer ne crée pas de doublon');

  assert.equal((await run(new Date(start - 25 * 3600000), confirmed.email)).length, 0, 'rien avant l’heure');
  const day = await run(new Date(start - 24 * 3600000 + 60000), confirmed.email);
  assert.equal(day.length, 1);
  assert.match(day[0].subject, /Rappel : votre rendez-vous est demain — CUTLY/);
  assert.match(day[0].text, /Dégradé classique/);
  assert.equal((await run(new Date(start - 24 * 3600000 + 120000), confirmed.email)).length, 0, 'un rappel n’est envoyé qu’une fois');
  const hours = await run(new Date(start - 2 * 3600000 + 60000), confirmed.email);
  assert.equal(hours.length, 1);
  assert.match(hours[0].subject, /dans 2 heures/);

  // Annulé entre-temps : l'état est relu juste avant l'envoi, aucun rappel ne part.
  const cancelled = await appointment('CONFIRMED');
  const cancelledRow = await db.prepare('SELECT * FROM appointments WHERE id=?').get(cancelled.id);
  await refreshAppointmentReminders(db, cancelledRow, { now: NOW });
  await db.prepare("UPDATE appointments SET status='CANCELLED' WHERE id=?").run(cancelled.id);
  assert.equal((await run(new Date(Date.parse(cancelledRow.starts_at) - 24 * 3600000 + 60000), cancelled.email)).length, 0);
  const obsolete = async () => (await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE appointment_id=? AND status='OBSOLETE'").get(cancelled.id)).n;
  assert.equal(await obsolete(), 1, 'le rappel de 24 h est abandonné');
  assert.equal((await run(new Date(Date.parse(cancelledRow.starts_at) - 2 * 3600000 + 60000), cancelled.email)).length, 0);
  assert.equal(await obsolete(), 2, 'puis celui de 2 h');

  // Encore en attente de validation : aucun rappel n'est programmé.
  const pending = await appointment('PENDING');
  await refreshAppointmentReminders(db, await db.prepare('SELECT * FROM appointments WHERE id=?').get(pending.id), { now: NOW });
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE appointment_id=? AND kind LIKE 'reminder:%'").get(pending.id)).n, 0);
});
