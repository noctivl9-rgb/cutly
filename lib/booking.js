const crypto = require('node:crypto');
const { enqueueClientSms } = require('./notifications');
const { withTransaction } = require('./database');
const { phoneVerificationRequired, phoneContactRequired } = require('./verification-policy');

const parisFormatter = new Intl.DateTimeFormat('en-CA', {
 timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
const parisParts = date => parisFormatter.formatToParts(date).reduce((result, part) => (result[part.type] = part.value, result), {});

function parisToUTC(date, time) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
 const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
 if (hour > 23 || minute > 59) return null;
 const target = Date.UTC(year, month - 1, day, hour, minute), calendarDate = new Date(Date.UTC(year, month - 1, day));
 if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null;
 let guess = target;
 for (let i = 0; i < 3; i++) {
  const p = parisParts(new Date(guess));
  guess += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
 }
 const result = new Date(guess), p = parisParts(result);
 if (+p.year !== year || +p.month !== month || +p.day !== day || +p.hour !== hour || +p.minute !== minute) return null;
 return result;
}

class BookingError extends Error { constructor(code, status = 409) { super(code); this.name = 'BookingError'; this.code = code; this.status = status; } }

async function createBooking(db, { userId, serviceId, date, time, idempotencyKey, rewardId = null, expectedPriceCents, expectedDurationMinutes, establishmentId = 'thomas-shop', now = new Date() }) {
 if (!userId) throw new BookingError('authentication_required', 401);
 if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 16 || idempotencyKey.length > 128) throw new BookingError('idempotency_key_required', 400);
 if ((expectedPriceCents !== undefined && (!Number.isSafeInteger(expectedPriceCents) || expectedPriceCents < 0)) ||
     (expectedDurationMinutes !== undefined && (!Number.isSafeInteger(expectedDurationMinutes) || expectedDurationMinutes <= 0))) throw new BookingError('invalid_booking_request', 400);
 const scope = `booking:${userId}`;
 try {
  return await withTransaction(db, async tx => {
   await tx.lock?.(`idempotency:${scope}:${idempotencyKey}`);
   const previous = await tx.prepare('SELECT scope,response_json FROM idempotency_keys WHERE key=?').get(idempotencyKey);
   if (previous) {
    if (previous.scope !== scope) throw new BookingError('idempotency_key_conflict', 409);
    return JSON.parse(previous.response_json);
   }
   const user = await tx.prepare('SELECT id,email,phone,first_name,last_name,email_verified_at,phone_verified_at,disabled_at,role FROM users WHERE id=?').get(userId);
   if (!user || user.disabled_at || user.role !== 'CLIENT') throw new BookingError('account_unavailable', 403);
   if (!user.email_verified_at || (phoneVerificationRequired && !user.phone_verified_at)) throw new BookingError('account_verification_required', 403);
   if (phoneContactRequired && (typeof user.phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(user.phone))) throw new BookingError('phone_contact_required', 403);
   const service = await tx.prepare('SELECT id,establishment_id,name,price_cents,duration_minutes,active,eligible FROM services WHERE id=?').get(serviceId);
   if (!service || !service.active || service.establishment_id !== establishmentId) throw new BookingError('service_unavailable', 404);
   if ((expectedPriceCents !== undefined && expectedPriceCents !== service.price_cents) ||
       (expectedDurationMinutes !== undefined && expectedDurationMinutes !== service.duration_minutes)) throw new BookingError('service_changed', 409);
   await tx.lock?.(`appointment-space:${service.establishment_id}`);
   let reward = null;
   if (rewardId) {
    if (service.id !== 'coupe-classique') throw new BookingError('reward_requires_classic_cut', 409);
    reward = await tx.prepare("SELECT id,cycle_number FROM rewards WHERE id=? AND user_id=? AND status='AVAILABLE'").get(rewardId, user.id);
    if (!reward) throw new BookingError('reward_unavailable', 409);
   }
   const start = parisToUTC(date, time);
   if (!start || start.getTime() <= now.getTime()) throw new BookingError('invalid_or_past_slot', 409);
   const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
   const hours = await tx.prepare('SELECT opens,closes FROM opening_hours WHERE establishment_id=? AND weekday=?').get(service.establishment_id, weekday);
   if (!hours?.opens || !hours.closes) throw new BookingError('outside_opening_hours', 409);
   const [openHour, openMinute] = hours.opens.split(':').map(Number), [closeHour, closeMinute] = hours.closes.split(':').map(Number);
   const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)), closeMinutes = closeHour * 60 + closeMinute;
   if (startMinutes % 15 !== 0 || startMinutes < openHour * 60 + openMinute || startMinutes + service.duration_minutes > closeMinutes) throw new BookingError('outside_opening_hours', 409);
   const end = new Date(start.getTime() + service.duration_minutes * 60000);
   const conflict = await tx.prepare(`SELECT 1 AS hit FROM appointments WHERE establishment_id=? AND status IN ('PENDING','CONFIRMED') AND starts_at<? AND ends_at>?
    UNION ALL SELECT 1 FROM unavailability WHERE establishment_id=? AND starts_at<? AND ends_at>? LIMIT 1`).get(service.establishment_id, end.toISOString(), start.toISOString(), service.establishment_id, end.toISOString(), start.toISOString());
   if (conflict) throw new BookingError('slot_unavailable', 409);
   const id = crypto.randomUUID(), createdAt = now.toISOString();
   const result = { id, status: 'PENDING', establishmentId: service.establishment_id, professional: 'Thomas', serviceId: service.id, serviceName: service.name, priceCents: reward ? 0 : service.price_cents, durationMinutes: service.duration_minutes, startsAt: start.toISOString(), endsAt: end.toISOString(), timezone: 'Europe/Paris', rewardId: reward?.id || null, createdAt };
   if (reward) {
    const reserved = await tx.prepare("UPDATE rewards SET status='RESERVED' WHERE id=? AND user_id=? AND status='AVAILABLE'").run(reward.id, user.id);
    if (reserved.changes !== 1) throw new BookingError('reward_unavailable', 409);
   }
   await tx.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,loyalty_eligible_snapshot,client_user_id,reward_id,status,payment_status,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).run(id, service.establishment_id, service.id, `${user.first_name} ${user.last_name}`.trim(), user.email, start.toISOString(), end.toISOString(), 'Europe/Paris', service.name, result.priceCents, service.duration_minutes, service.eligible, user.id, reward?.id || null, reward ? 'NOT_APPLICABLE' : 'UNPAID', createdAt);
   await tx.prepare('INSERT INTO idempotency_keys(key,scope,response_json,created_at) VALUES(?,?,?,?)').run(idempotencyKey, scope, JSON.stringify(result), createdAt);
   await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,?,'BOOKING_REQUESTED','APPOINTMENT',?,?,'SUCCESS',?)`).run(crypto.randomUUID(), userId, service.establishment_id, id, JSON.stringify(result), createdAt);
   const adminEmail = (await tx.prepare("SELECT u.email FROM establishment_members m JOIN users u ON u.id=m.user_id WHERE m.establishment_id=? AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1 ORDER BY u.created_at LIMIT 1").get(service.establishment_id))?.email;
   await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL','booking_requested:client','PENDING',?,?)`).run(crypto.randomUUID(), id, JSON.stringify({ email: user.email, service: service.name, priceCents: result.priceCents, startsAt: result.startsAt, timezone: 'Europe/Paris', recipient: 'client' }), createdAt);
   if (adminEmail) await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL','booking_requested:admin','PENDING',?,?)`).run(crypto.randomUUID(), id, JSON.stringify({ email: adminEmail, client: `${user.first_name} ${user.last_name}`.trim(), service: service.name, priceCents: result.priceCents, startsAt: result.startsAt, timezone: 'Europe/Paris', recipient: 'admin' }), createdAt);
   await enqueueClientSms(tx, { id, client_user_id: user.id, service_name_snapshot: service.name, starts_at: result.startsAt, timezone: 'Europe/Paris' }, 'booking_requested:client', {}, createdAt);
   return result;
  });
 } catch (error) {
  if (error.code === 'SQLITE_CONSTRAINT_TRIGGER' || error.code === 'SQLITE_CONSTRAINT_EXCLUSION' || String(error.message).includes('appointment_overlap')) throw new BookingError('slot_unavailable', 409);
  throw error;
 }
}

module.exports = { BookingError, createBooking, parisToUTC };
