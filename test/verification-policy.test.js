const {test}=require('node:test');
const assert=require('node:assert/strict');
const {phoneVerificationRequired,phoneContactRequired,smsEnabled}=require('../lib/verification-policy');
const {smsAppointmentNotificationsEnabled}=require('../lib/notifications');

test('launch policy requires verified email and a contact phone, with SMS disabled',()=>{
 const previous=process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;
 try {
  assert.equal(phoneVerificationRequired,false);
  assert.equal(phoneContactRequired,true);
  assert.equal(smsEnabled,false);
  delete process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;
  assert.equal(smsAppointmentNotificationsEnabled(),false);
  process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS='true';
  assert.equal(smsAppointmentNotificationsEnabled(),false);
 } finally {
  if(previous===undefined)delete process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;
  else process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS=previous;
 }
});
