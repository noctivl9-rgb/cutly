const crypto = require('node:crypto');
const { withTransaction } = require('./database');

class LoyaltyError extends Error { constructor(code, status = 409) { super(code); this.name = 'LoyaltyError'; this.code = code; this.status = status; } }

async function reconcileInTransaction(tx, { appointmentId, actorId, now = new Date() }) {
  const appointment = await tx.prepare(`SELECT a.*,e.id AS establishment_id FROM appointments a JOIN establishments e ON e.id=a.establishment_id WHERE a.id=?`).get(appointmentId);
  if (!appointment) throw new LoyaltyError('appointment_not_found', 404);
  const admin = await tx.prepare("SELECT u.id FROM users u JOIN establishment_members m ON m.user_id=u.id WHERE u.id=? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1").get(actorId, appointment.establishment_id);
  if (!admin) throw new LoyaltyError('forbidden', 403);
  if (appointment.status !== 'COMPLETED' || appointment.payment_status !== 'PAID') throw new LoyaltyError('completion_and_payment_required', 409);
  if (!appointment.client_user_id) return { awarded: false, reason: 'client_account_missing' };
  if (!appointment.loyalty_eligible_snapshot || appointment.price_cents_snapshot <= 0) return { awarded: false, reason: 'not_eligible' };
  await tx.lock?.(`loyalty:${appointment.client_user_id}`);
  const duplicate = await tx.prepare("SELECT id FROM loyalty_ledger WHERE appointment_id=? AND kind='EARN'").get(appointmentId);
  if (duplicate) return { awarded: false, reason: 'already_earned', ledgerId: duplicate.id };
  const latest = await tx.prepare('SELECT COALESCE(MAX(cycle_number),0) AS cycle FROM rewards WHERE user_id=?').get(appointment.client_user_id);
  const cycle = latest.cycle + 1;
  const before = await tx.prepare('SELECT COALESCE(SUM(points),0) AS total FROM loyalty_ledger WHERE user_id=? AND cycle_number=?').get(appointment.client_user_id, cycle);
  const ledgerId = crypto.randomUUID(), createdAt = now.toISOString();
  await tx.prepare(`INSERT INTO loyalty_ledger(id,user_id,appointment_id,kind,points,cycle_number,actor_id,reason,created_at) VALUES(?,?,?,'EARN',1,?,?,?,?)`).run(ledgerId, appointment.client_user_id, appointmentId, cycle, actorId, 'Completed and paid eligible service', createdAt);
  const total = before.total + 1; let reward = null;
  if (total >= 10) {
   reward = { id: crypto.randomUUID(), cycleNumber: cycle, status: 'AVAILABLE', earnedAt: createdAt };
   await tx.prepare("INSERT INTO rewards(id,user_id,cycle_number,status,earned_at) VALUES(?,?,?,'AVAILABLE',?)").run(reward.id, appointment.client_user_id, cycle, createdAt);
   await tx.prepare('UPDATE loyalty_ledger SET reward_id=? WHERE id=?').run(reward.id, ledgerId);
  }
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,reason,result,created_at) VALUES(?,?,?,'LOYALTY_POINT_EARNED','LOYALTY_LEDGER',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, appointment.establishment_id, ledgerId, JSON.stringify({ appointmentId, userId: appointment.client_user_id, points: 1, cycle, total, reward }), `Completed and paid eligible service${reward ? ' — reward created' : ''}`, createdAt);
  return { awarded: true, ledgerId, points: total, cycle, reward };
}

async function reconcileCompletedPaidAppointment(db, args) {
 return withTransaction(db, tx => reconcileInTransaction(tx, args));
}

module.exports = { LoyaltyError, reconcileCompletedPaidAppointment, reconcileInTransaction };
