const { parisToUTC } = require('./booking');
const { withTransaction } = require('./database');
class DashboardError extends Error { constructor(code, status = 403) { super(code); this.name = 'DashboardError'; this.code = code; this.status = status; } }
function parisDate(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
function addCalendarDay(date, days) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

async function getDashboardSummary(db, { actorId, now = new Date() }) {
 return withTransaction(db, async tx => {
  const actor = await tx.prepare("SELECT id,role,disabled_at FROM users WHERE id=?").get(actorId);
  if (!actor || actor.disabled_at || actor.role !== 'ESTABLISHMENT_ADMIN') throw new DashboardError('forbidden');
  const member = await tx.prepare("SELECT 1 AS allowed FROM establishment_members WHERE user_id=? AND establishment_id='thomas-shop' AND role='ESTABLISHMENT_ADMIN' AND active=1").get(actorId);
  if (!member) throw new DashboardError('forbidden');
  const today = parisDate(now), start = parisToUTC(today, '00:00'), end = parisToUTC(addCalendarDay(today, 1), '00:00');
  if (!start || !end) throw new DashboardError('calendar_boundary_error', 500);
  const startUtc = start.toISOString(), endUtc = end.toISOString(), nowUtc = now.toISOString();
  const counts = await tx.prepare(`SELECT
   SUM(CASE WHEN starts_at>=? AND starts_at<? THEN 1 ELSE 0 END) AS today,
   SUM(CASE WHEN starts_at>=? AND status='PENDING' THEN 1 ELSE 0 END) AS pending,
   SUM(CASE WHEN starts_at>=? AND status='CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
   SUM(CASE WHEN starts_at>=? AND starts_at<? AND status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
   SUM(CASE WHEN starts_at>=? AND starts_at<? AND status='CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
   SUM(CASE WHEN starts_at>=? AND starts_at<? AND status='NO_SHOW' THEN 1 ELSE 0 END) AS noShow
   FROM appointments WHERE establishment_id=?`).get(startUtc, endUtc, nowUtc, nowUtc, startUtc, endUtc, startUtc, endUtc, startUtc, endUtc, 'thomas-shop');
  const revenue = await tx.prepare(`SELECT COALESCE(SUM(p.amount_cents),0) AS cents FROM payment_events p JOIN appointments a ON a.id=p.appointment_id
   WHERE a.establishment_id=? AND a.status='COMPLETED' AND p.status IN ('PAID','CORRECTION') AND p.created_at>=? AND p.created_at<?
   AND NOT EXISTS(SELECT 1 FROM payment_events newer WHERE newer.correction_of=p.id)`).get('thomas-shop', startUtc, endUtc);
  const clients = await tx.prepare("SELECT COUNT(DISTINCT client_user_id) AS total FROM appointments WHERE establishment_id='thomas-shop' AND client_user_id IS NOT NULL").get();
  const cancellationRequests = await tx.prepare("SELECT COUNT(*) AS total FROM cancellation_requests c JOIN appointments a ON a.id=c.appointment_id WHERE a.establishment_id='thomas-shop' AND c.status='PENDING'").get();
  const rewards = await tx.prepare(`SELECT SUM(CASE WHEN r.status='AVAILABLE' THEN 1 ELSE 0 END) AS available,
   SUM(CASE WHEN r.status='USED' THEN 1 ELSE 0 END) AS used FROM rewards r WHERE EXISTS
   (SELECT 1 FROM loyalty_ledger l JOIN appointments a ON a.id=l.appointment_id WHERE l.reward_id=r.id AND a.establishment_id='thomas-shop')`).get();
  const popular = await tx.prepare(`SELECT service_name_snapshot AS name,COUNT(*) AS bookings FROM appointments
   WHERE establishment_id=? AND status='COMPLETED' AND starts_at>=? AND starts_at<? GROUP BY service_name_snapshot ORDER BY bookings DESC,name LIMIT 5`).all('thomas-shop', startUtc, endUtc);
  return { timezone: 'Europe/Paris', date: today, period: { from: startUtc, to: endUtc }, appointments: { today: counts.today || 0, upcomingPending: counts.pending || 0, upcomingConfirmed: counts.confirmed || 0, completed: counts.completed || 0, cancelled: counts.cancelled || 0, noShow: counts.noShow || 0, pendingCancellationRequests: cancellationRequests.total }, clients: clients.total, revenueCents: revenue.cents, rewards: { available: rewards.available || 0, used: rewards.used || 0 }, popularServices: popular };
 });
}

module.exports = { DashboardError, getDashboardSummary };
