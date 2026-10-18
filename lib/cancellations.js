const crypto = require('node:crypto');
const { refreshAppointmentReminders, enqueueClientSms, enqueueEmail } = require('./notifications');
const { withTransaction } = require('./database');
class CancellationError extends Error { constructor(code, status = 409) { super(code); this.name = 'CancellationError'; this.code = code; this.status = status; } }

async function requestCancellation(db, { appointmentId, actorId, reason = null, now = new Date() }) {
 return withTransaction(db, async tx => {
  const appointment = await tx.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  if (!appointment) throw new CancellationError('appointment_not_found', 404);
  const actor = await tx.prepare('SELECT id,role,disabled_at FROM users WHERE id=?').get(actorId);
  if (!actor || actor.disabled_at || actor.role !== 'CLIENT' || appointment.client_user_id !== actorId) throw new CancellationError('forbidden', 403);
  if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) throw new CancellationError('appointment_not_cancellable', 409);
  const timestamp = now.toISOString(), hoursUntil = (Date.parse(appointment.starts_at) - now.getTime()) / 3_600_000;
  if (hoursUntil > 24) {
   const version = appointment.version + 1;
   const result = await tx.prepare("UPDATE appointments SET status='CANCELLED',version=? WHERE id=? AND version=? AND status IN ('PENDING','CONFIRMED')").run(version, appointmentId, appointment.version);
   if (result.changes !== 1) throw new CancellationError('version_conflict', 409);
   if (appointment.reward_id) {
    const reward = await tx.prepare("UPDATE rewards SET status='AVAILABLE',used_appointment_id=NULL,used_at=NULL WHERE id=? AND status='RESERVED'").run(appointment.reward_id);
    if (reward.changes !== 1) throw new CancellationError('reward_state_conflict', 409);
    await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at) VALUES(?,?,?,'REWARD_AVAILABLE','REWARD',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, appointment.reward_id, JSON.stringify({ status: 'RESERVED', appointmentId }), JSON.stringify({ status: 'AVAILABLE' }), 'Appointment cancelled', timestamp);
   }
   await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at) VALUES(?,?,?,'CLIENT_CANCELLED','APPOINTMENT',?,?,?,?, 'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, appointmentId, JSON.stringify({ status: appointment.status, version: appointment.version }), JSON.stringify({ status: 'CANCELLED', version }), reason, timestamp);
   await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL','appointment_cancelled','PENDING',?,?)`).run(crypto.randomUUID(), appointmentId, JSON.stringify({ appointmentId, email: appointment.client_email, status: 'CANCELLED' }), timestamp);
   await enqueueClientSms(tx, appointment, 'appointment_cancelled', {}, timestamp);
   await refreshAppointmentReminders(tx, { ...appointment, status: 'CANCELLED', version });
   return { type: 'CANCELLED', appointmentId, status: 'CANCELLED', version };
  }
  const pending = await tx.prepare("SELECT id,status FROM cancellation_requests WHERE appointment_id=? AND status='PENDING'").get(appointmentId);
  if (pending) return { type: 'REQUEST_PENDING', requestId: pending.id, status: pending.status };
  const id = crypto.randomUUID();
  await tx.prepare("INSERT INTO cancellation_requests(id,appointment_id,requested_by,status,reason,created_at) VALUES(?,?,?,'PENDING',?,?)").run(id, appointmentId, actorId, typeof reason === 'string' ? reason.trim().slice(0, 500) : null, timestamp);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,reason,result,created_at) VALUES(?,?,?,'CANCELLATION_REQUESTED','CANCELLATION_REQUEST',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, id, JSON.stringify({ appointmentId, status: 'PENDING' }), reason, timestamp);
  const adminEmail = (await tx.prepare("SELECT u.email FROM establishment_members m JOIN users u ON u.id=m.user_id WHERE m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1 ORDER BY u.created_at LIMIT 1").get(appointment.establishment_id))?.email || null;
  await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL','cancellation_requested','PENDING',?,?)`).run(crypto.randomUUID(), appointmentId, JSON.stringify({ appointmentId, email: adminEmail, status: 'PENDING', requestedAt: timestamp }), timestamp);
  // Le client reçoit un accusé de réception : le rendez-vous reste actif tant que Thomas n'a pas décidé.
  await enqueueEmail(tx, { kind: `cancellation_received:${id}`, to: appointment.client_email, appointmentId, payload: { appointmentId }, dedupeKey: `cancellation-received:${id}`, now: new Date(timestamp) });
  return { type: 'REQUEST_PENDING', requestId: id, status: 'PENDING' };
 }).catch(error => { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new CancellationError('request_already_pending', 409); throw error; });
}

async function resolveCancellationRequest(db, { requestId, actorId, decision, expectedVersion, reason = null, now = new Date() }) {
 if (!['ACCEPTED', 'REJECTED'].includes(decision)) throw new CancellationError('invalid_decision', 400);
 if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new CancellationError('version_required', 400);
 return withTransaction(db, async tx => {
  const request = await tx.prepare('SELECT * FROM cancellation_requests WHERE id=?').get(requestId);
  if (!request) throw new CancellationError('request_not_found', 404);
  if (request.status !== 'PENDING') throw new CancellationError('request_already_resolved', 409);
  const appointment = await tx.prepare('SELECT * FROM appointments WHERE id=?').get(request.appointment_id);
  if (!appointment) throw new CancellationError('appointment_not_found', 404);
  if (appointment.version !== expectedVersion) throw new CancellationError('version_conflict', 409);
  const admin = await tx.prepare("SELECT 1 FROM users u JOIN establishment_members m ON m.user_id=u.id WHERE u.id=? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1").get(actorId, appointment.establishment_id);
  if (!admin) throw new CancellationError('forbidden', 403);
  if (!['PENDING', 'CONFIRMED'].includes(appointment.status)) throw new CancellationError('appointment_not_cancellable', 409);
  if (decision === 'REJECTED' && (!reason || !String(reason).trim())) throw new CancellationError('reason_required', 400);
  const timestamp = now.toISOString();
  const resolved = await tx.prepare("UPDATE cancellation_requests SET status=?,resolved_at=?,resolved_by=? WHERE id=? AND status='PENDING'").run(decision, timestamp, actorId, requestId);
  if (resolved.changes !== 1) throw new CancellationError('request_already_resolved', 409);
  let version = appointment.version;
  if (decision === 'ACCEPTED') {
   await tx.lock?.(`appointment-space:${appointment.establishment_id}`);
   version++;
   const updated = await tx.prepare("UPDATE appointments SET status='CANCELLED',version=? WHERE id=? AND version=? AND status IN ('PENDING','CONFIRMED')").run(version, appointment.id, appointment.version);
   if (updated.changes !== 1) throw new CancellationError('version_conflict', 409);
   if (appointment.reward_id) {
    const reward = await tx.prepare("UPDATE rewards SET status='AVAILABLE',used_appointment_id=NULL,used_at=NULL WHERE id=? AND status='RESERVED'").run(appointment.reward_id);
    if (reward.changes !== 1) throw new CancellationError('reward_state_conflict', 409);
    await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at) VALUES(?,?,?,'REWARD_AVAILABLE','REWARD',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, appointment.reward_id, JSON.stringify({ status: 'RESERVED', appointmentId: appointment.id }), JSON.stringify({ status: 'AVAILABLE' }), 'Cancellation request accepted', timestamp);
   }
   await refreshAppointmentReminders(tx, { ...appointment, status: 'CANCELLED', version });
  }
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at) VALUES(?,?,?, ?, 'CANCELLATION_REQUEST', ?,?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, `CANCELLATION_${decision}`, requestId, JSON.stringify({ requestStatus: 'PENDING', appointmentStatus: appointment.status, appointmentVersion: appointment.version }), JSON.stringify({ requestStatus: decision, appointmentStatus: decision === 'ACCEPTED' ? 'CANCELLED' : appointment.status, appointmentVersion: version }), reason, timestamp);
  await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL',?,'PENDING',?,?)`).run(crypto.randomUUID(), appointment.id, `cancellation_${decision.toLowerCase()}`, JSON.stringify({ appointmentId: appointment.id, email: appointment.client_email, decision, reason }), timestamp);
  await enqueueClientSms(tx, appointment, `cancellation_${decision.toLowerCase()}`, { decision }, timestamp);
  return { requestId, status: decision, appointmentStatus: decision === 'ACCEPTED' ? 'CANCELLED' : appointment.status, version };
 });
}

module.exports = { CancellationError, requestCancellation, resolveCancellationRequest };
