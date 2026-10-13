const crypto = require('node:crypto');
const { emailConfigured, smsConfigured, sendEmail, sendSms } = require('./providers');
const { withTransaction } = require('./database');

function smsAppointmentNotificationsEnabled() { return process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS === 'true'; }

async function enqueueClientSms(db, appointment, kind, additional = {}, createdAt = new Date().toISOString()) {
 if (!smsAppointmentNotificationsEnabled() || !appointment.client_user_id) return false;
 const client = await db.prepare("SELECT phone,phone_verified_at FROM users WHERE id=? AND role='CLIENT' AND disabled_at IS NULL").get(appointment.client_user_id);
 if (!client?.phone || !client.phone_verified_at) return false;
 const payload = { phone: client.phone, service: appointment.service_name_snapshot, startsAt: appointment.starts_at, timezone: appointment.timezone, ...additional };
 await db.prepare("INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'SMS',?,'PENDING',?,?)").run(crypto.randomUUID(), appointment.id, kind, JSON.stringify(payload), createdAt);
 return true;
}

async function refreshAppointmentReminders(db, appointment, { now = new Date() } = {}) {
 const timestamp = now.toISOString();
 await db.prepare("UPDATE notification_outbox SET status='OBSOLETE',next_attempt_at=NULL WHERE appointment_id=? AND kind LIKE 'reminder:%' AND status IN ('PENDING','RETRYING')").run(appointment.id);
 if (appointment.status !== 'CONFIRMED') return;
 const start = Date.parse(appointment.starts_at); if (!Number.isFinite(start)) return;
 for (const hours of [24, 2]) {
  const sendAt = new Date(start - hours * 3600000); if (sendAt <= now) continue;
  const kind = `reminder:${hours}h:v${appointment.version}`;
  const payload = { email: appointment.client_email, service: appointment.service_name_snapshot, startsAt: appointment.starts_at, timezone: appointment.timezone };
  await db.prepare("INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,next_attempt_at,created_at) VALUES(?,?,'EMAIL',?,'PENDING',?,?,?)").run(crypto.randomUUID(), appointment.id, kind, JSON.stringify(payload), sendAt.toISOString(), timestamp);
  if (smsAppointmentNotificationsEnabled()) await enqueueClientSms(db, appointment, kind, {}, timestamp);
 }
}

function template(row) {
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
 const time = payload.startsAt ? new Date(payload.startsAt).toLocaleString('fr-FR', { timeZone: payload.timezone || 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' }) : '';
 const service = payload.service || 'votre rendez-vous', price = Number.isSafeInteger(payload.priceCents) ? ` · ${(payload.priceCents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}` : '';
 let subject = 'Mise à jour de votre rendez-vous CUTLY', text = `${service}${time ? ` — ${time}` : ''}${price}`;
 if (row.kind === 'booking_requested:client') { subject = 'Demande de réservation envoyée — CUTLY'; text = `Votre demande pour ${service} le ${time} a bien été envoyée. Elle sera confirmée après validation par Thomas.${price}`; }
 else if (row.kind === 'booking_requested:admin') { subject = 'Nouvelle demande de réservation — CUTLY'; text = `${payload.client || 'Un client'} demande ${service} le ${time}.${price}`; }
 else if (row.kind.startsWith('appointment_status:')) { const status = row.kind.split(':')[1]; subject = status === 'CONFIRMED' ? 'Rendez-vous confirmé — CUTLY' : status === 'REJECTED' ? 'Demande de réservation refusée — CUTLY' : status === 'CANCELLED' ? 'Rendez-vous annulé — CUTLY' : 'Mise à jour de votre rendez-vous — CUTLY'; text = status === 'CONFIRMED' ? `Votre rendez-vous ${service} le ${time} est confirmé.` : status === 'REJECTED' ? `La demande pour ${service} le ${time} n’a pas été acceptée.` : `Le statut de votre rendez-vous ${service} le ${time} a changé : ${status}.`; }
 else if (row.kind.startsWith('appointment_modified:')) { subject = 'Votre rendez-vous a été modifié — CUTLY'; text = `Votre rendez-vous ${service} a été modifié. Nouveau créneau : ${time}.`; }
 else if (row.kind.startsWith('reminder:')) { const hours = row.kind.split(':')[1]; subject = 'Rappel de votre rendez-vous — CUTLY'; text = `Rappel : votre rendez-vous ${service} a lieu ${time}.`; if (hours === '24h') text = `Rappel : votre rendez-vous ${service} est prévu dans environ 24 heures, le ${time}.`; else if (hours === '2h') text = `Rappel : votre rendez-vous ${service} est prévu dans environ 2 heures, le ${time}.`; }
 else if (row.kind === 'appointment_cancelled') { subject = 'Votre rendez-vous a été annulé — CUTLY'; text = `Votre rendez-vous ${service} le ${time} est annulé.`; }
 else if (row.kind === 'cancellation_requested') { subject = 'Demande d’annulation à traiter — CUTLY'; text = 'Un client a demandé l’annulation d’un rendez-vous. Connectez-vous à l’administration CUTLY pour traiter la demande.'; }
 else if (row.kind.startsWith('cancellation_')) { subject = 'Décision sur votre demande d’annulation — CUTLY'; text = payload.decision === 'ACCEPTED' ? 'La demande d’annulation a été acceptée.' : 'La demande d’annulation n’a pas été acceptée. Le rendez-vous reste confirmé.'; }
 else return null;
 return { to: payload.email, subject, text, idempotencyKey: row.id };
}

async function processOutbox(db, { now = new Date(), limit = 10, deliver = null } = {}) {
 const emailReady = deliver ? true : emailConfigured(), smsReady = deliver ? true : smsConfigured();
 if (!emailReady && !smsReady) return { processed: 0, configured: false };
 let processed = 0;
 for (let count = 0; count < Math.min(50, Math.max(1, limit)); count++) {
  const row = await withTransaction(db, async tx => {
   await tx.lock?.('notification-outbox-dispatch');
   const candidate = await tx.prepare("SELECT * FROM notification_outbox WHERE status IN ('PENDING','RETRYING') AND (next_attempt_at IS NULL OR next_attempt_at<=?) AND ((channel='EMAIL' AND ?=1) OR (channel='SMS' AND ?=1)) ORDER BY COALESCE(next_attempt_at,created_at),created_at LIMIT 1").get(now.toISOString(), Number(emailReady), Number(smsReady));
   if (!candidate) return null;
   const claimed = await tx.prepare("UPDATE notification_outbox SET status='RETRYING',attempts=attempts+1,next_attempt_at=? WHERE id=? AND status IN ('PENDING','RETRYING')").run(new Date(now.getTime() + 5 * 60000).toISOString(), candidate.id);
   if (claimed.changes !== 1) return null;
   return { ...candidate, attempts: candidate.attempts + 1 };
  });
  if (!row) break;
  const message = template(row);
  try {
   if (!message) throw new Error('invalid_notification_payload');
   const receipt = await (deliver || (row.channel === 'SMS' ? sendSms : sendEmail))(message);
   await db.prepare("UPDATE notification_outbox SET status='SENT',sent_at=?,next_attempt_at=NULL,last_error=NULL,provider_name=?,provider_message_id=?,provider_status=? WHERE id=? AND status='RETRYING'").run(now.toISOString(), receipt?.provider || null, receipt?.id || null, receipt?.status || 'ACCEPTED', row.id);
  } catch (error) {
   const uncertainSms = row.channel === 'SMS' && error.code === 'sms_provider_outcome_unknown', exhausted = row.attempts >= 5 || uncertainSms;
   const next = exhausted ? null : new Date(now.getTime() + Math.min(4 * 60 * 60_000, 60_000 * 2 ** (row.attempts - 1))).toISOString();
   await db.prepare("UPDATE notification_outbox SET status=?,next_attempt_at=?,last_error=?,provider_status='FAILED' WHERE id=? AND status='RETRYING'").run(exhausted ? 'FAILED' : 'RETRYING', next, String(error.code || error.message || 'delivery_failed').slice(0, 160), row.id);
  }
  processed++;
 }
 return { processed, configured: emailReady || smsReady };
}

module.exports = { refreshAppointmentReminders, processOutbox, template, enqueueClientSms, smsAppointmentNotificationsEnabled };
