const { parisToUTC } = require('./booking');

const TIMEZONE = 'Europe/Paris';
function validDate(date) {
 if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
 const parsed = new Date(`${date}T12:00:00Z`);
 return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
function nextDate(date) {
 const value = new Date(`${date}T12:00:00Z`);
 value.setUTCDate(value.getUTCDate() + 1);
 return value.toISOString().slice(0, 10);
}
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const overlaps = (interval, start, end) => new Date(interval.startsAt).getTime() < end && new Date(interval.endsAt).getTime() > start;

// Read only interval bounds. Public responses never contain appointment/customer identifiers.
async function loadSchedule(db, establishmentId, firstDate, lastDate) {
 const firstInstant = parisToUTC(firstDate, '00:00');
 const lastInstant = parisToUTC(nextDate(lastDate), '00:00');
 if (!firstInstant || !lastInstant) {
  const error = new Error('invalid_date'); error.status = 400; error.code = 'invalid_date'; throw error;
 }
 const start = firstInstant.toISOString(), end = lastInstant.toISOString();
 const [hours, appointments, blocks] = await Promise.all([
  db.prepare('SELECT weekday,opens,closes FROM opening_hours WHERE establishment_id=?').all(establishmentId),
  db.prepare("SELECT starts_at AS startsAt,ends_at AS endsAt FROM appointments WHERE establishment_id=? AND status IN ('PENDING','CONFIRMED') AND starts_at<? AND ends_at>?").all(establishmentId, end, start),
  db.prepare('SELECT starts_at AS startsAt,ends_at AS endsAt FROM unavailability WHERE establishment_id=? AND starts_at<? AND ends_at>?').all(establishmentId, end, start)
 ]);
 return { hours, appointments, blocks };
}

function dayAvailability(date, service, schedule, now) {
 const empty = { date, timezone: TIMEZONE, status: 'CLOSED', availableCount: 0, slots: [], entries: [] };
 if (!validDate(date)) return empty;
 const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
 const hours = schedule.hours.find(row => row.weekday === weekday);
 if (!hours?.opens || !hours.closes) return empty;
 const openAt = minutes(hours.opens), closeAt = minutes(hours.closes);
 const entries = [];
 // Match the server booking rule: starts lie on a clock-aligned 15-minute grid.
 for (let minute = Math.ceil(openAt / 15) * 15; minute < closeAt; minute += 15) {
  const time = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const instant = parisToUTC(date, time);
  const start = instant?.getTime(), end = start + service.duration_minutes * 60000;
  let status = 'AVAILABLE';
  if (!instant || minute + service.duration_minutes > closeAt) status = 'UNAVAILABLE';
  else if (start <= now.getTime()) status = 'PAST';
  else if (schedule.appointments.some(interval => overlaps(interval, start, end))) status = 'OCCUPIED';
  else if (schedule.blocks.some(interval => overlaps(interval, start, end))) status = 'UNAVAILABLE';
  entries.push({ time, status });
 }
 const slots = entries.filter(entry => entry.status === 'AVAILABLE').map(entry => entry.time);
 return { date, timezone: TIMEZONE, status: slots.length ? 'OPEN' : 'FULL', availableCount: slots.length, slots, entries };
}

async function getDayAvailability(db, { date, service, now = new Date() }) {
 if (!validDate(date)) return dayAvailability(date, service, { hours: [] }, now);
 const schedule = await loadSchedule(db, service.establishment_id, date, date);
 return dayAvailability(date, service, schedule, now);
}

async function getMonthAvailability(db, { month, service, now = new Date() }) {
 if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) {
  const error = new Error('invalid_month'); error.status = 400; error.code = 'invalid_month'; throw error;
 }
 const [year, number] = month.split('-').map(Number);
 const lastDay = new Date(Date.UTC(year, number, 0)).getUTCDate();
 const schedule = await loadSchedule(db, service.establishment_id, `${month}-01`, `${month}-${lastDay}`);
 const days = Array.from({ length: lastDay }, (_, index) => {
  const date = `${month}-${String(index + 1).padStart(2, '0')}`;
  const { status, availableCount } = dayAvailability(date, service, schedule, now);
  return { date, status, availableCount };
 });
 return { month, timezone: TIMEZONE, days };
}

module.exports = { getDayAvailability, getMonthAvailability };
