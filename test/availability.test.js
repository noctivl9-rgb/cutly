const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { getDayAvailability, getMonthAvailability } = require('../lib/availability');
const { parisToUTC } = require('../lib/booking');

const service = { establishment_id: 'thomas-shop', duration_minutes: 30 };
const now = new Date('2030-01-01T00:00:00Z');
function fixture() {
 const db = new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE opening_hours(establishment_id TEXT,weekday INTEGER,opens TEXT,closes TEXT);
 CREATE TABLE appointments(id TEXT,establishment_id TEXT,starts_at TEXT,ends_at TEXT,status TEXT,client_name TEXT);
 CREATE TABLE unavailability(establishment_id TEXT,starts_at TEXT,ends_at TEXT,reason TEXT);
 INSERT INTO opening_hours VALUES('thomas-shop',6,'09:00','19:00'),('thomas-shop',0,'09:00','19:00');`);
 return db;
}
function booking(db, id, time, duration = 30, status = 'PENDING', establishment = 'thomas-shop') {
 const start = parisToUTC('2030-01-05', time);
 db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?)').run(id, establishment, start.toISOString(), new Date(+start + duration * 60000).toISOString(), status, 'PRIVATE CUSTOMER');
}

test('public grid retains occupied overlapping starts and excludes personal data', async () => {
 const db = fixture();
 try {
  booking(db, 'pending', '10:00'); booking(db, 'confirmed', '11:00', 15, 'CONFIRMED');
  booking(db, 'other-shop', '12:00', 30, 'PENDING', 'other-shop');
  const result = await getDayAvailability(db, { date: '2030-01-05', service, now });
  const state = time => result.entries.find(entry => entry.time === time).status;
  assert.equal(state('09:30'), 'AVAILABLE');
  for (const time of ['10:00','11:00']) assert.equal(state(time), 'OCCUPIED');
  for (const time of ['10:30','11:30','12:00']) assert.equal(state(time), 'AVAILABLE');
  assert.equal(result.entries.some(entry => /:(15|45)$/.test(entry.time)), false); assert.equal(result.slots.at(-1), '18:30');
  assert.deepEqual(result.slots, result.entries.filter(entry => entry.status === 'AVAILABLE').map(entry => entry.time));
  assert.equal(JSON.stringify(result).includes('PRIVATE CUSTOMER'), false);
  assert.ok(result.entries.every(entry => Object.keys(entry).join(',') === 'time,status'));
  const short = await getDayAvailability(db, { date: '2030-01-05', service: { ...service, duration_minutes: 15 }, now });
  assert.equal(short.entries.some(entry => /:(15|45)$/.test(entry.time)), false);
  assert.equal(short.slots.at(-1), '18:30');
 } finally { db.close(); }
});

test('fresh grid reflects rejection, cancellation and private unavailability without cached states', async () => {
 const db = fixture();
 try {
  booking(db, 'request', '10:00');
  const read = () => getDayAvailability(db, { date: '2030-01-05', service, now });
  assert.equal((await read()).entries.find(entry => entry.time === '10:00').status, 'OCCUPIED');
  db.prepare("UPDATE appointments SET status='REJECTED' WHERE id='request'").run();
  assert.ok((await read()).slots.includes('10:00'));
  booking(db, 'confirmed', '10:00', 30, 'CONFIRMED');
  assert.ok(!(await read()).slots.includes('10:00'));
  db.prepare("UPDATE appointments SET status='CANCELLED' WHERE id='confirmed'").run();
  assert.ok((await read()).slots.includes('10:00'));
  db.prepare('INSERT INTO unavailability VALUES(?,?,?,?)').run('thomas-shop', parisToUTC('2030-01-05','10:00').toISOString(), parisToUTC('2030-01-05','10:15').toISOString(), 'PRIVATE REASON');
  const blocked = await read();
  assert.equal(blocked.entries.find(entry => entry.time === '10:00').status, 'UNAVAILABLE');
  assert.equal(blocked.entries.find(entry => entry.time === '10:30').status, 'AVAILABLE');
  assert.equal(JSON.stringify(blocked).includes('PRIVATE REASON'), false);
 } finally { db.close(); }
});

test('calendar summary distinguishes closed, full and open days and rejects malformed months', async () => {
 const db = fixture();
 try {
  booking(db, 'full', '09:00', 600, 'CONFIRMED');
  const result = await getMonthAvailability(db, { month: '2030-01', service, now });
  assert.equal(result.days.length, 31);
  assert.deepEqual(result.days.find(day => day.date === '2030-01-05'), { date: '2030-01-05', status: 'FULL', availableCount: 0 });
  assert.deepEqual(result.days.find(day => day.date === '2030-01-06'), { date: '2030-01-06', status: 'OPEN', availableCount: 20 });
  assert.deepEqual(result.days.find(day => day.date === '2030-01-07'), { date: '2030-01-07', status: 'CLOSED', availableCount: 0 });
  await assert.rejects(() => getMonthAvailability(db, { month: '2030-13', service, now }), { code: 'invalid_month', status: 400 });
  assert.deepEqual((await getDayAvailability(db, { date: '2030-02-31', service, now })).entries, []);
 } finally { db.close(); }
});

test('Paris DST, same-day starts and clock-aligned opening boundaries use actual instants', async () => {
 const db = fixture();
 try {
  for (const date of ['2030-03-31', '2030-10-27']) {
   const result = await getDayAvailability(db, { date, service, now: parisToUTC(date, '09:00') });
   assert.equal(result.entries[0].status, 'PAST'); assert.equal(result.slots[0], '09:30');
   assert.equal(result.slots.at(-1), '18:30');
  }
  db.prepare("UPDATE opening_hours SET opens='09:10' WHERE weekday=6").run();
  assert.equal((await getDayAvailability(db, { date: '2030-01-05', service, now })).slots[0], '09:30');
 } finally { db.close(); }
});
