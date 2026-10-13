const crypto = require('node:crypto');
const { withTransaction } = require('./database');
class ReviewError extends Error { constructor(code, status = 409) { super(code); this.name = 'ReviewError'; this.code = code; this.status = status; } }

async function submitReview(db, { appointmentId, userId, rating, comment = null, now = new Date() }) {
 if (typeof appointmentId !== 'string' || appointmentId.length < 1 || appointmentId.length > 100) throw new ReviewError('invalid_appointment', 400);
 if (!Number.isSafeInteger(rating) || rating < 1 || rating > 5) throw new ReviewError('invalid_rating', 400);
 if (comment !== null && (typeof comment !== 'string' || comment.trim().length > 2000)) throw new ReviewError('invalid_comment', 400);
 return withTransaction(db, async tx => {
  const appointment = await tx.prepare("SELECT * FROM appointments WHERE id=? AND client_user_id=? AND establishment_id='thomas-shop'").get(appointmentId, userId);
  if (!appointment) throw new ReviewError('appointment_not_found', 404);
  if (appointment.status !== 'COMPLETED') throw new ReviewError('appointment_not_completed', 409);
  const id = crypto.randomUUID(), createdAt = now.toISOString(), normalizedComment = comment?.trim() || null;
  try {
   await tx.prepare("INSERT INTO reviews(id,appointment_id,user_id,rating,comment,status,created_at) VALUES(?,?,?,?,?,'PENDING_MODERATION',?)").run(id, appointmentId, userId, rating, normalizedComment, createdAt);
  } catch (error) {
   if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(error.message).includes('UNIQUE')) throw new ReviewError('review_already_submitted', 409);
   throw error;
  }
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,?,'REVIEW_SUBMITTED','REVIEW',?,?,'SUCCESS',?)`).run(crypto.randomUUID(), userId, appointment.establishment_id, id, JSON.stringify({ appointmentId, rating, status: 'PENDING_MODERATION' }), createdAt);
  return { id, appointmentId, rating, comment: normalizedComment, status: 'PENDING_MODERATION', createdAt };
 });
}

async function decideReview(db, { reviewId, actorId, decision, reason = null, now = new Date() }) {
 if (!['PUBLISHED', 'HIDDEN'].includes(decision)) throw new ReviewError('invalid_review_decision', 400);
 if (decision === 'HIDDEN' && (typeof reason !== 'string' || !reason.trim())) throw new ReviewError('reason_required', 400);
 return withTransaction(db, async tx => {
  const review = await tx.prepare("SELECT r.*,a.establishment_id FROM reviews r JOIN appointments a ON a.id=r.appointment_id WHERE r.id=? AND a.establishment_id='thomas-shop'").get(reviewId);
  if (!review) throw new ReviewError('review_not_found', 404);
  const admin = await tx.prepare("SELECT 1 FROM users u JOIN establishment_members m ON m.user_id=u.id WHERE u.id=? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1").get(actorId, review.establishment_id);
  if (!admin) throw new ReviewError('forbidden', 403);
  if (!['PENDING_MODERATION', 'PUBLISHED', 'HIDDEN', 'REPORTED'].includes(review.status)) throw new ReviewError('invalid_review_state', 409);
  const timestamp = now.toISOString();
  const changed = await tx.prepare('UPDATE reviews SET status=? WHERE id=? AND status=?').run(decision, review.id, review.status);
  if (changed.changes !== 1) throw new ReviewError('review_state_conflict', 409);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at) VALUES(?,?,?,?,?,?,?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(), actorId, review.establishment_id, decision === 'PUBLISHED' ? 'REVIEW_APPROVED' : 'REVIEW_HIDDEN', 'REVIEW', review.id, JSON.stringify({ status: review.status }), JSON.stringify({ status: decision }), reason?.trim() || null, timestamp);
  return { id: review.id, status: decision, updatedAt: timestamp };
 });
}

module.exports = { ReviewError, submitReview, decideReview };
