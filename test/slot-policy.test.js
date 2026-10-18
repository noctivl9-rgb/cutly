const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../scripts/audit-slot-grid');

test('read-only audit counts legacy starts and seconds without exposing identities or changing inputs', () => {
 const rows = [
  { starts_at: '2030-01-05T12:00:00.000Z', status: 'PENDING', client_name: 'PRIVATE' },
  { starts_at: '2030-01-05T12:15:00.000Z', status: 'PENDING' },
  { starts_at: '2030-07-06T11:30:00.000Z', status: 'CONFIRMED' },
  { starts_at: '2030-07-06T11:30:00.001Z', status: 'CONFIRMED' },
  { starts_at: 'invalid', status: 'CANCELLED' }
 ];
 const before = JSON.stringify(rows);
 assert.deepEqual(summarize(rows), { timezone: 'Europe/Paris', startIntervalMinutes: 30, inspected: 5, nonconforming: 2, byStatus: { PENDING: 1, CONFIRMED: 1 }, invalidInstants: 1 });
 assert.equal(JSON.stringify(rows), before);
 assert.equal(JSON.stringify(summarize(rows)).includes('PRIVATE'), false);
});
