const crypto = require('node:crypto');
const { emailConfigured, smsConfigured, sendEmail, sendSms } = require('./providers');
const { renderEmail } = require('./email-templates');
const { withTransaction } = require('./database');
const { smsEnabled } = require('./verification-policy');

function smsAppointmentNotificationsEnabled() { return smsEnabled && process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS === 'true'; }

async function enqueueClientSms(db, appointment, kind, additional = {}, createdAt = new Date().toISOString(), sendAt = null) {
 if (!smsAppointmentNotificationsEnabled() || !appointment.client_user_id) return false;
 const client = await db.prepare("SELECT phone,phone_verified_at FROM users WHERE id=? AND role='CLIENT' AND disabled_at IS NULL").get(appointment.client_user_id);
 if (!client?.phone || !client.phone_verified_at) return false;
 const payload = { phone: client.phone, service: appointment.service_name_snapshot, startsAt: appointment.starts_at, timezone: appointment.timezone, ...additional };
 await db.prepare("INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at,next_attempt_at) VALUES(?,?,'SMS',?,'PENDING',?,?,?)").run(crypto.randomUUID(), appointment.id, kind, JSON.stringify(payload), createdAt, sendAt);
 return true;
}

async function refreshAppointmentReminders(db, appointment, { now = new Date() } = {}) {
 const timestamp = now.toISOString();
 const currentKinds = appointment.status === 'CONFIRMED' ? [24,2].map(hours=>`reminder:${hours}h:v${appointment.version}`) : ['', ''];
 await db.prepare("UPDATE notification_outbox SET status='OBSOLETE',next_attempt_at=NULL WHERE appointment_id=? AND kind LIKE 'reminder:%' AND kind NOT IN (?,?) AND status IN ('PENDING','RETRYING')").run(appointment.id,...currentKinds);
 if (appointment.status !== 'CONFIRMED') return;
 const start = Date.parse(appointment.starts_at); if (!Number.isFinite(start)) return;
 for (const hours of [24, 2]) {
  const sendAt = new Date(start - hours * 3600000); if (sendAt <= now) continue;
  const kind = `reminder:${hours}h:v${appointment.version}`;
  const payload = { email: appointment.client_email, service: appointment.service_name_snapshot, startsAt: appointment.starts_at, timezone: appointment.timezone };
  await db.prepare("INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,next_attempt_at,created_at) VALUES(?,?,'EMAIL',?,'PENDING',?,?,?)").run(crypto.randomUUID(), appointment.id, kind, JSON.stringify(payload), sendAt.toISOString(), timestamp);
  if (smsAppointmentNotificationsEnabled()) await enqueueClientSms(db, appointment, kind, {}, timestamp, sendAt.toISOString());
 }
}

function template(row, context = null) {
 let payload; try { payload = JSON.parse(row.payload_json); } catch { return null; }
 if (row.channel === 'SMS') {
  if (!payload || typeof payload.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(payload.phone)) return null;
  const time = payload.startsAt ? new Date(payload.startsAt).toLocaleString('fr-FR', { timeZone: payload.timezone || 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }) : '';
  const service = payload.service || 'votre rendez-vous'; let text;
  if (row.kind === 'booking_requested:client') text = `CUTLY : demande reçue pour ${service} le ${time}. Elle sera confirmée après validation par Thomas.`;
  else if (row.kind.startsWith('appointment_status:')) { const status = row.kind.split(':')[1]; text = status === 'CONFIRMED' ? `CUTLY : rendez-vous ${service} confirmé le ${time}.` : status === 'REJECTED' ? `CUTLY : la demande pour ${service} le ${time} n’a pas été acceptée.` : `CUTLY : rendez-vous ${service} le ${time}, statut ${status}.`; }
  else if (row.kind.startsWith('appointment_modified:')) text = `CUTLY : rendez-vous modifié. ${service}, nouveau créneau : ${time}.`;
  else if (row.kind.startsWith('reminder:')) { const hours = row.kind.split(':')[1]; text = `CUTLY : rappel, rendez-vous ${service} le ${time}.`; if (hours === '24h') text = `CUTLY : rappel, rendez-vous ${service} dans environ 24 h (${time}).`; else if (hours === '2h') text = `CUTLY : rappel, rendez-vous ${service} dans environ 2 h (${time}).`; }
  else if (row.kind === 'appointment_cancelled') text = `CUTLY : rendez-vous ${service} le ${time} annulé.`;
  else if (row.kind.startsWith('cancellation_')) text = payload.decision === 'ACCEPTED' ? 'CUTLY : votre demande d’annulation est acceptée.' : 'CUTLY : votre demande d’annulation est refusée ; le rendez-vous reste prévu.';
  else return null;
  return { to: payload.phone, text };
 }
 if (!payload || typeof payload.email !== 'string') return null;
 // Le contexte lu en base (rendez-vous, prénom) prime sur le contenu de l'événement : jamais de donnée périmée dans un e-mail.
 const data = { ...payload };
 if (context) Object.assign(data, {
  appointmentId: context.id, service: context.service_name_snapshot, startsAt: context.starts_at, timezone: context.timezone || 'Europe/Paris',
  durationMinutes: context.duration_minutes_snapshot, priceCents: context.price_cents_snapshot, clientName: payload.client || context.client_name, firstName: context.first_name || payload.firstName
 });
 const rendered = renderEmail(row.kind, data, { recipient: payload.email });
 if (!rendered) return null;
 if (rendered.skip) return { skip: true };
 return { to: payload.email, subject: rendered.subject, text: rendered.text, html: rendered.html, idempotencyKey: row.id, template: rendered.template, tags: [{ name: 'template', value: rendered.template }] };
}

const ACCOUNT_KINDS = new Set(['verify-email', 'password-reset', 'welcome']);
// Les liens à usage unique ne restent pas en base une fois l'envoi terminé.
function scrubbedPayload(row) { try { const { url, token, ...rest } = JSON.parse(row.payload_json); return JSON.stringify(rest); } catch { return row.payload_json; } }

// Ajoute un e-mail à la file. dedupeKey : un même événement ne produit jamais deux messages.
async function enqueueEmail(db, { kind, to, appointmentId = null, payload = {}, dedupeKey = null, sendAt = null, now = new Date() }) {
 const id = crypto.randomUUID();
 const result = await db.prepare("INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at,next_attempt_at,dedupe_key) VALUES(?,?,'EMAIL',?,'PENDING',?,?,?,?)")
  .run(id, appointmentId, kind, JSON.stringify({ email: String(to).trim().toLowerCase(), ...payload }), now.toISOString(), sendAt, dedupeKey);
 return { id, queued: result.changes === 1 };
}
// E-mails de compte (vérification, mot de passe oublié, bienvenue) : le lien est construit ici, avec l'adresse publique du site.
async function enqueueAccountEmail(db, { kind, to, token = null, firstName = null, idempotencyKey = null, expiresMinutes = 30, now = new Date() }) {
 const payload = { firstName, expiresMinutes };
 if (token) {
  const { publicBaseUrl } = require('./providers');
  const url = new URL('/account.html', publicBaseUrl());
  url.searchParams.set(kind === 'password-reset' ? 'resetPassword' : 'verifyEmail', token);
  payload.url = url.toString();
 }
 return enqueueEmail(db, { kind, to, payload, dedupeKey: idempotencyKey || `${kind}:${crypto.randomUUID()}`, now });
}

async function loadAppointmentContext(db, row) {
 if (!row.appointment_id) return null;
 return (await db.prepare('SELECT a.id,a.status,a.starts_at,a.timezone,a.service_name_snapshot,a.price_cents_snapshot,a.duration_minutes_snapshot,a.client_name,u.first_name FROM appointments a LEFT JOIN users u ON u.id=a.client_user_id WHERE a.id=?').get(row.appointment_id)) || null;
}
async function isSuppressed(db, email) {
 try { return Boolean(await db.prepare('SELECT 1 FROM email_suppressions WHERE email=?').get(String(email).trim().toLowerCase())); }
 catch (error) { if (/email_suppressions/.test(String(error.message))) return false; throw error; }
}

async function processOutbox(db, { now = new Date(), limit = 10, deliver = null } = {}) {
 const emailReady = deliver ? true : emailConfigured(), smsReady = deliver ? true : smsEnabled && smsConfigured();
 if (!emailReady && !smsReady) return { processed: 0, configured: false };
 let processed = 0;
 for (let count = 0; count < Math.min(50, Math.max(1, limit)); count++) {
  const row = await withTransaction(db, async tx => {
   await tx.lock?.('notification-outbox-dispatch');
   const candidate = await tx.prepare("SELECT * FROM notification_outbox WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND ((channel='EMAIL' AND ?=1) OR (channel='SMS' AND ?=1)) ORDER BY COALESCE(next_attempt_at,created_at),created_at LIMIT 1").get(now.toISOString(), Number(emailReady), Number(smsReady));
   if (!candidate) return null;
   if(candidate.channel==='SMS' && candidate.provider_status==='DISPATCHING') {
    // A process may have died after the provider accepted this non-idempotent SMS.
    await tx.prepare("UPDATE notification_outbox SET status='FAILED',next_attempt_at=NULL,last_error='sms_provider_outcome_unknown',provider_status='UNKNOWN' WHERE id=?").run(candidate.id);
    return { skipped:true };
   }
   if(candidate.kind.startsWith('reminder:')) {
    const appointment=await tx.prepare('SELECT status,version,starts_at FROM appointments WHERE id=?').get(candidate.appointment_id);
    if(!appointment || appointment.status!=='CONFIRMED' || !candidate.kind.endsWith(`:v${appointment.version}`) || Date.parse(appointment.starts_at)<=now.getTime()) {
     await tx.prepare("UPDATE notification_outbox SET status='OBSOLETE',next_attempt_at=NULL WHERE id=?").run(candidate.id);
     return { skipped:true };
    }
   }
   if(candidate.channel==='EMAIL' && candidate.appointment_id) {
    // Jamais d'information contredite par l'état réel du rendez-vous au moment de l'envoi.
    const appointment=await tx.prepare('SELECT status FROM appointments WHERE id=?').get(candidate.appointment_id);
    const stale=appointment && ((candidate.kind==='booking_requested:client' && appointment.status!=='PENDING') || (candidate.kind.startsWith('appointment_status:') && appointment.status!==candidate.kind.split(':')[1]));
    if(stale) {
     await tx.prepare("UPDATE notification_outbox SET status='OBSOLETE',next_attempt_at=NULL,provider_status='SUPERSEDED' WHERE id=?").run(candidate.id);
     return { skipped:true };
    }
   }
   const claimed = await tx.prepare("UPDATE notification_outbox SET status='RETRYING',attempts=attempts+1,next_attempt_at=?,provider_status='DISPATCHING' WHERE id=? AND status IN ('PENDING','RETRYING')").run(new Date(now.getTime() + 5 * 60000).toISOString(), candidate.id);
   if (claimed.changes !== 1) return null;
   return { ...candidate, attempts: candidate.attempts + 1 };
  });
  if (!row) break;
  if (row.skipped) continue;
  try {
   const message = template(row, row.channel === 'EMAIL' ? await loadAppointmentContext(db, row) : null);
   if (message?.skip) { await db.prepare("UPDATE notification_outbox SET status='OBSOLETE',next_attempt_at=NULL,provider_status='NOT_APPLICABLE' WHERE id=?").run(row.id); processed++; continue; }
   if (!message) throw new Error('invalid_notification_payload');
   if (row.channel === 'EMAIL' && await isSuppressed(db, message.to)) {
    await db.prepare("UPDATE notification_outbox SET status='FAILED',next_attempt_at=NULL,last_error='recipient_suppressed',provider_status='SUPPRESSED',payload_json=? WHERE id=?").run(ACCOUNT_KINDS.has(row.kind) ? scrubbedPayload(row) : row.payload_json, row.id);
    processed++; continue;
   }
   const receipt = await (deliver || (row.channel === 'SMS' ? sendSms : sendEmail))(message);
   await db.prepare("UPDATE notification_outbox SET status='SENT',sent_at=?,next_attempt_at=NULL,last_error=NULL,provider_name=?,provider_message_id=?,provider_status=?,payload_json=? WHERE id=? AND status='RETRYING'").run(now.toISOString(), receipt?.provider || null, receipt?.id || null, receipt?.status || 'ACCEPTED', ACCOUNT_KINDS.has(row.kind) ? scrubbedPayload(row) : row.payload_json, row.id);
  } catch (error) {
   const uncertainSms = row.channel === 'SMS' && ['sms_provider_outcome_unknown','sms_provider_invalid_response'].includes(error.code);
   // Clé ou domaine refusé : on attend la configuration sans épuiser les tentatives (48 h maximum).
   const waitingForConfiguration = error.configuration === true && now.getTime() - Date.parse(row.created_at) < 48 * 3600000;
   const exhausted = uncertainSms || error.permanent === true || (!waitingForConfiguration && row.attempts >= 5);
   const next = exhausted ? null : new Date(now.getTime() + (waitingForConfiguration ? 30 * 60_000 : Math.min(4 * 60 * 60_000, 60_000 * 2 ** (row.attempts - 1)))).toISOString();
   const errorCode=String(error.code || error.message || 'delivery_failed');
   const providerStatus = error.permanent === true ? 'REJECTED' : 'FAILED';
   await db.prepare("UPDATE notification_outbox SET status=?,next_attempt_at=?,last_error=?,provider_status=?,attempts=? WHERE id=? AND status='RETRYING'").run(exhausted ? 'FAILED' : 'RETRYING', next, /^[a-z0-9_:]{1,100}$/.test(errorCode)?errorCode:'delivery_failed', providerStatus, waitingForConfiguration ? Math.max(0, row.attempts - 1) : row.attempts, row.id);
   if (exhausted && ACCOUNT_KINDS.has(row.kind)) await db.prepare('UPDATE notification_outbox SET payload_json=? WHERE id=?').run(scrubbedPayload(row), row.id);
  }
  processed++;
 }
 return { processed, configured: emailReady || smsReady };
}

// ---------- Suivi du fournisseur (webhooks) ----------
// Signature Svix utilisée par Resend : HMAC-SHA256 de « id.horodatage.corps » avec la clé « whsec_… » décodée.
function verifyWebhookSignature({ secret, id, timestamp, signature, body, now = Date.now(), toleranceSeconds = 300 }) {
 if (typeof secret !== 'string' || !secret || !id || !timestamp || !signature || typeof body !== 'string') return false;
 const seconds = Number(timestamp); if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > toleranceSeconds) return false;
 const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
 const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
 return String(signature).split(' ').some(part => {
  const [version, value] = part.split(','); if (version !== 'v1' || !value) return false;
  const a = Buffer.from(value), b = Buffer.from(expected); return a.length === b.length && crypto.timingSafeEqual(a, b);
 });
}
const EVENT_STATUS = { 'email.delivered': 'DELIVERED', 'email.delivery_delayed': 'DELAYED', 'email.bounced': 'BOUNCED', 'email.complained': 'COMPLAINED', 'email.failed': 'FAILED', 'email.suppressed': 'SUPPRESSED' };
const STATUS_RANK = { ACCEPTED: 1, DELAYED: 2, DELIVERED: 3, BOUNCED: 4, COMPLAINED: 4, FAILED: 4, SUPPRESSED: 4 };
// Applique un événement du fournisseur : jamais deux fois (identifiant d'événement), jamais en arrière (livré ne redevient pas « retardé »).
async function applyProviderEvent(db, { eventId, type, messageId, occurredAt = null, detail = null, recipients = [], bounceType = null, now = new Date() }) {
 const status = EVENT_STATUS[type];
 if (!status || !eventId) return { ignored: true };
 const outbox = messageId ? await db.prepare('SELECT id,provider_status FROM notification_outbox WHERE provider_message_id=?').get(messageId) : null;
 const inserted = await db.prepare('INSERT OR IGNORE INTO notification_events(id,outbox_id,provider_event_id,provider_message_id,type,occurred_at,received_at,detail) VALUES(?,?,?,?,?,?,?,?)')
  .run(crypto.randomUUID(), outbox?.id || null, eventId, messageId || null, type, occurredAt || now.toISOString(), now.toISOString(), detail ? String(detail).slice(0, 300) : null);
 if (inserted.changes !== 1) return { duplicate: true };
 if (outbox && (STATUS_RANK[status] || 0) >= (STATUS_RANK[outbox.provider_status] || 0)) await db.prepare('UPDATE notification_outbox SET provider_status=? WHERE id=?').run(status, outbox.id);
 // Rebond définitif ou plainte : on n'écrit plus à cette adresse.
 if (status === 'COMPLAINED' || status === 'SUPPRESSED' || (status === 'BOUNCED' && /^permanent$/i.test(String(bounceType || '')))) {
  for (const email of recipients) await db.prepare('INSERT OR IGNORE INTO email_suppressions(email,reason,created_at) VALUES(?,?,?)').run(String(email).trim().toLowerCase(), status.toLowerCase(), now.toISOString());
 }
 return { applied: true, status, outboxId: outbox?.id || null };
}

module.exports = { refreshAppointmentReminders, processOutbox, template, enqueueClientSms, smsAppointmentNotificationsEnabled, enqueueEmail, enqueueAccountEmail, verifyWebhookSignature, applyProviderEvent, ACCOUNT_KINDS };
