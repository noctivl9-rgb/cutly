const crypto = require('node:crypto');
const { reconcileInTransaction } = require('./loyalty');
const { withTransaction } = require('./database');
class PaymentError extends Error { constructor(code, status = 409) { super(code); this.name = 'PaymentError'; this.code = code; this.status = status; } }

async function recordOnsitePayment(db, { appointmentId, actorId, expectedVersion, amountCents, method = null, now = new Date() }) {
 if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new PaymentError('version_required', 400);
 if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new PaymentError('invalid_amount', 400);
 if (method !== null && (typeof method !== 'string' || method.length > 40)) throw new PaymentError('invalid_method', 400);
 return withTransaction(db, async tx => {
  await tx.lock?.(`payment:${appointmentId}`);
  const appointment = await tx.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  if (!appointment) throw new PaymentError('appointment_not_found', 404);
  if (appointment.version !== expectedVersion) throw new PaymentError('version_conflict', 409);
  const admin = await tx.prepare("SELECT 1 AS allowed FROM users u JOIN establishment_members m ON m.user_id=u.id WHERE u.id=? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1").get(actorId, appointment.establishment_id);
  if (!admin) throw new PaymentError('forbidden', 403);
  if (appointment.status !== 'COMPLETED') throw new PaymentError('appointment_not_completed', 409);
  if (appointment.payment_status !== 'UNPAID') throw new PaymentError('payment_not_unpaid', 409);
  if (amountCents !== appointment.price_cents_snapshot) throw new PaymentError('amount_mismatch', 409);
  const createdAt = now.toISOString(), eventId = crypto.randomUUID(), version = appointment.version + 1;
  await tx.prepare("INSERT INTO payment_events(id,appointment_id,status,amount_cents,method,actor_id,created_at) VALUES(?,?,'PAID',?,?,?,?)").run(eventId, appointmentId, amountCents, method, actorId, createdAt);
  const changed = await tx.prepare("UPDATE appointments SET payment_status='PAID',version=? WHERE id=? AND version=? AND payment_status='UNPAID'").run(version, appointmentId, expectedVersion);
  if (changed.changes !== 1) throw new PaymentError('version_conflict', 409);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at)
   VALUES(?,?,?,'ONSITE_PAYMENT_RECORDED','PAYMENT',?,?,?,?, 'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, eventId, JSON.stringify({ status: 'UNPAID', amountCents: 0 }), JSON.stringify({ status: 'PAID', amountCents, method }), `Paiement déclaré par Thomas${method ? ` · ${method}` : ''}`, createdAt);
  const loyalty = await reconcileInTransaction(tx, { appointmentId, actorId, now });
  return { id: eventId, appointmentId, status: 'PAID', amountCents, method, version, createdAt, loyalty };
 });
}

async function correctOnsitePayment(db, { appointmentId, actorId, expectedVersion, amountCents, method = null, reason, now = new Date() }) {
 if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new PaymentError('version_required', 400);
 if (!Number.isSafeInteger(amountCents) || amountCents < 1) throw new PaymentError('invalid_amount', 400);
 if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 500) throw new PaymentError('reason_required', 400);
 if (method !== null && (typeof method !== 'string' || method.length > 40)) throw new PaymentError('invalid_method', 400);
 return withTransaction(db, async tx => {
  await tx.lock?.(`payment:${appointmentId}`);
  const appointment = await tx.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  if (!appointment) throw new PaymentError('appointment_not_found', 404);
  if (appointment.version !== expectedVersion) throw new PaymentError('version_conflict', 409);
  const admin = await tx.prepare("SELECT 1 AS allowed FROM users u JOIN establishment_members m ON m.user_id=u.id WHERE u.id=? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1").get(actorId, appointment.establishment_id);
  if (!admin) throw new PaymentError('forbidden', 403);
  if (appointment.status !== 'COMPLETED') throw new PaymentError('appointment_not_completed', 409);
  if (appointment.payment_status !== 'PAID') throw new PaymentError('payment_not_paid', 409);
  if (amountCents > appointment.price_cents_snapshot) throw new PaymentError('amount_exceeds_service_price', 409);
  const previous = await tx.prepare("SELECT p.* FROM payment_events p WHERE p.appointment_id=? AND p.status IN ('PAID','CORRECTION') AND NOT EXISTS(SELECT 1 FROM payment_events newer WHERE newer.correction_of=p.id) ORDER BY p.created_at DESC,p.id DESC LIMIT 1").get(appointmentId);
  if (!previous) throw new PaymentError('payment_record_not_found', 409);
  const createdAt = now.toISOString(), eventId = crypto.randomUUID(), version = appointment.version + 1;
  await tx.prepare("INSERT INTO payment_events(id,appointment_id,status,amount_cents,method,actor_id,reason,correction_of,created_at) VALUES(?,?,'CORRECTION',?,?,?,?,?,?)").run(eventId, appointmentId, amountCents, method, actorId, reason.trim(), previous.id, createdAt);
  const changed = await tx.prepare("UPDATE appointments SET version=? WHERE id=? AND version=? AND payment_status='PAID'").run(version, appointmentId, expectedVersion);
  if (changed.changes !== 1) throw new PaymentError('version_conflict', 409);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at)
   VALUES(?,?,?,'ONSITE_PAYMENT_CORRECTED','PAYMENT',?,?,?,?, 'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, eventId, JSON.stringify({ eventId: previous.id, status: previous.status, amountCents: previous.amount_cents, method: previous.method }), JSON.stringify({ eventId, status: 'CORRECTION', amountCents, method, correctionOf: previous.id }), reason.trim(), createdAt);
  const loyalty = await reconcileInTransaction(tx, { appointmentId, actorId, now });
  return { id: eventId, appointmentId, status: 'PAID', amountCents, method, correctionOf: previous.id, reason: reason.trim(), version, createdAt, loyalty };
 });
}

module.exports = { PaymentError, recordOnsitePayment, correctOnsitePayment };
