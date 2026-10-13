const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { createBooking, BookingError } = require('../lib/booking');
const { transitionAppointment, AppointmentError } = require('../lib/appointments');
const { reconcileCompletedPaidAppointment, LoyaltyError } = require('../lib/loyalty');
const { recordOnsitePayment, correctOnsitePayment, PaymentError } = require('../lib/payments');
const { submitReview, decideReview, ReviewError } = require('../lib/reviews');
const { getDashboardSummary, DashboardError } = require('../lib/dashboard');
const { hashPassword, encodeBase32, totp, encryptTotpSecret } = require('../lib/auth');
const { parisToUTC } = require('../lib/booking');
const { registerClient, verifyEmail, verifyPhone, requestPasswordReset, resetClientPassword } = require('../lib/accounts');
const { processOutbox, template } = require('../lib/notifications');
const { createDatabase, parameterize, postgresSql } = require('../lib/database');
const { makeBackup } = require('../scripts/migrate-sqlite-to-postgres');

let child, baseUrl, tempDir;
const mfaSecret=encodeBase32(require('node:crypto').randomBytes(20));
const mfaEncryptionKey=require('node:crypto').randomBytes(32).toString('base64');
function upcomingWeekend(weeks=0){const d=new Date();const day=d.getUTCDay();const delta=day===6?7:(6-day+7)%7;d.setUTCDate(d.getUTCDate()+delta+weeks*7);const sat=d.toISOString().slice(0,10);d.setUTCDate(d.getUTCDate()+1);return [sat,d.toISOString().slice(0,10)];}
function reservePort() {
 return new Promise((resolve,reject)=>{const socket=net.createServer();socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(err=>err?reject(err):resolve(port));});});
}
before(async()=>{
 tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'cutly-test-'));
 const port=await reservePort(); baseUrl=`http://127.0.0.1:${port}`;
 child=spawn(process.execPath,[path.join(__dirname,'..','server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',PORT:String(port),CUTLY_HOST:'127.0.0.1',CUTLY_DB_PATH:path.join(tempDir,'cutly.sqlite'),CUTLY_MFA_ENCRYPTION_KEY:mfaEncryptionKey},stdio:['ignore','pipe','pipe']});
 let output='';
 child.stdout.on('data',chunk=>{output+=chunk;});
 child.stderr.on('data',chunk=>{output+=chunk;});
 const started=Date.now();
 while(Date.now()-started<10000){
  if(child.exitCode!==null)throw new Error(`server exited early: ${output}`);
  try{const response=await fetch(`${baseUrl}/api/status`);if(response.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 throw new Error(`server did not start: ${output}`);
});
after(async()=>{
 if(child&&!child.killed){child.kill('SIGINT');await Promise.race([once(child,'exit'),new Promise(r=>setTimeout(r,2000))]);}
 if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});
});

test('public shop exposes the official catalogue and opening hours',async()=>{
 const r=await fetch(`${baseUrl}/api/shop`),shop=await r.json();
 assert.equal(r.status,200);assert.equal(shop.name,'Thomas Shop');assert.equal(shop.timezone,'Europe/Paris');
 assert.deepEqual(shop.services.map(s=>[s.name,s.priceCents,s.durationMinutes]),[
  ['Dégradé classique',500,30],['Burst Fade',700,30],['Taper',500,30],['Coupe classique',500,30],['Contours',500,15]
 ]);
 assert.equal(shop.hours.length,7);assert.deepEqual(shop.hours.filter(h=>h.open).map(h=>[h.weekday,h.open,h.close]),[[0,'09:00','19:00'],[6,'09:00','19:00']]);
});

test('availability follows duration, weekend and past-time rules',async()=>{
 const [saturday,sunday]=upcomingWeekend();const monday=new Date(`${sunday}T12:00:00Z`);monday.setUTCDate(monday.getUTCDate()+1);
 const thirty=await (await fetch(`${baseUrl}/api/availability?service=coupe-classique&date=${saturday}`)).json();
 const fifteen=await (await fetch(`${baseUrl}/api/availability?service=contours&date=${sunday}`)).json();
 const closed=await (await fetch(`${baseUrl}/api/availability?service=taper&date=${monday.toISOString().slice(0,10)}`)).json();
 const invalid=await (await fetch(`${baseUrl}/api/availability?service=taper&date=2026-02-31`)).json();
 assert.equal(thirty.slots.at(-1),'18:30');assert.ok(!thirty.slots.includes('18:45'));
 assert.equal(fifteen.slots.at(-1),'18:45');assert.deepEqual(closed.slots,[]);assert.deepEqual(invalid.slots,[]);
});

test('booking cannot bypass required verified account',async()=>{
 const [saturday]=upcomingWeekend();const r=await fetch(`${baseUrl}/api/bookings`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientName:'Test Client',clientEmail:'test@example.com',serviceId:'coupe-classique',date:saturday,time:'09:00'})});
 assert.equal(r.status,401);assert.equal((await r.json()).error,'authentication_required');
 const cancellation=await fetch(`${baseUrl}/api/client/appointments/unknown/cancellation`,{method:'POST',headers:{origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({})});assert.equal(cancellation.status,401);
});

test('unconfigured providers are reported honestly',async()=>{
 const status=await (await fetch(`${baseUrl}/api/status`)).json();
 assert.equal(status.emailProvider,'NOT_CONFIGURED');assert.equal(status.smsProvider,'NOT_CONFIGURED');assert.equal(status.adminMfa,'CONFIGURED');assert.equal(status.booking,'BLOCKED');assert.equal(status.smsAppointmentNotifications,'DISABLED');assert.ok(status.blockers.includes('EMAIL_PROVIDER_NOT_CONFIGURED'));assert.ok(status.blockers.includes('SMS_PROVIDER_NOT_CONFIGURED'));
 const blocked=await fetch(`${baseUrl}/api/auth/client/register`,{method:'POST',headers:{'content-type':'application/json',origin:baseUrl},body:JSON.stringify({firstName:'Test',lastName:'Client',email:'blocked@example.test',phone:'+33612345678',password:'a-strong-test-password'})});assert.equal(blocked.status,503);
});

test('client verification and password recovery challenges are one-time and expire by use',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 const previousKey=process.env.CUTLY_MFA_ENCRYPTION_KEY;process.env.CUTLY_MFA_ENCRYPTION_KEY=mfaEncryptionKey;
 try{
  db.exec('PRAGMA foreign_keys=ON');const messages=[];
  const account=await registerClient(db,{firstName:'Test',lastName:'Client',email:'journey@example.test',phone:'+33612345671',password:'a-strong-test-password'},{sendEmail:async message=>messages.push({channel:'EMAIL',...message}),sendSms:async message=>messages.push({channel:'SMS',...message})});
  assert.equal(account.verificationRequired.email,true);assert.equal(account.verificationRequired.phone,true);assert.equal(messages.length,2);
  const email=messages.find(message=>message.channel==='EMAIL'),sms=messages.find(message=>message.channel==='SMS');
  assert.deepEqual(await verifyEmail(db,{token:email.token}),{verified:true});await assert.rejects(()=>verifyEmail(db,{token:email.token}),/invalid_or_expired_token/);
  assert.deepEqual(await verifyPhone(db,{email:account.email,code:sms.code}),{verified:true});assert.deepEqual(await verifyPhone(db,{email:account.email,code:sms.code}),{verified:true});
  await requestPasswordReset(db,{email:account.email,sendEmail:async message=>messages.push({channel:'RESET',...message})});
  const reset=messages.find(message=>message.channel==='RESET');assert.ok(reset.token);assert.equal((await resetClientPassword(db,{token:reset.token,newPassword:'another-strong-password'})).reset,true);
  await assert.rejects(()=>resetClientPassword(db,{token:reset.token,newPassword:'yet-another-password'}),/invalid_or_expired_token/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND revoked_at IS NULL').get(account.userId).count,0);
 }finally{db.close();if(previousKey===undefined)delete process.env.CUTLY_MFA_ENCRYPTION_KEY;else process.env.CUTLY_MFA_ENCRYPTION_KEY=previousKey;}
});

test('admin HTTP routes require password, TOTP, an active membership and a valid session',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 const now=new Date().toISOString(),id='http-admin';
 try{
  db.exec('PRAGMA foreign_keys=ON');
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES(?,?, 'Thomas','Shop',?,'ESTABLISHMENT_ADMIN',?,?)`).run(id,'http-admin@example.com',await hashPassword('a-secure-local-test-password'),now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES(?,'thomas-shop','ESTABLISHMENT_ADMIN')").run(id);
  db.prepare('INSERT INTO admin_mfa(user_id,secret_encrypted,enabled,last_used_step,created_at) VALUES(?,?,1,-1,?)').run(id,encryptTotpSecret(mfaSecret,Buffer.from(mfaEncryptionKey,'base64')),now);
 }finally{db.close();}
 const denied=await fetch(`${baseUrl}/api/admin/dashboard`);assert.equal(denied.status,401);
 const otp=totp(mfaSecret,Math.floor(Date.now()/30000));
 const login=await fetch(`${baseUrl}/api/auth/admin/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'http-admin@example.com',password:'a-secure-local-test-password',otp})});
 assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
 const cookie=login.headers.get('set-cookie').split(';')[0];
 const reviewAdminDenied=await fetch(`${baseUrl}/api/admin/reviews`);assert.equal(reviewAdminDenied.status,401);
 const reviewAdminList=await fetch(`${baseUrl}/api/admin/reviews`,{headers:{cookie}});assert.equal(reviewAdminList.status,200);
 const publicReviews=await fetch(`${baseUrl}/api/reviews`);assert.equal(publicReviews.status,200);assert.deepEqual((await publicReviews.json()).reviews,[]);
 const cancelDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));let clientCookie;
 try{const timestamp=new Date().toISOString();cancelDb.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES('http-client','http-client@example.com','Client','Test',?,'CLIENT',?,?)`).run(await hashPassword('client-password-safe-123'),timestamp,timestamp);const insert=cancelDb.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at) VALUES(?,'thomas-shop','coupe-classique','http-client','Client Test','http-client@example.com',?,?,'Europe/Paris','Coupe classique',500,30,?,?)`);for(const [id,status,offset] of [['cancel-request-accept','CONFIRMED',12],['cancel-request-reject','PENDING',13]]){const start=new Date(Date.now()+offset*3600000);insert.run(id,start.toISOString(),new Date(start.getTime()+30*60000).toISOString(),status,timestamp);}}finally{cancelDb.close();}
 const clientLogin=await fetch(`${baseUrl}/api/auth/client/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'http-client@example.com',password:'client-password-safe-123'})});assert.equal(clientLogin.status,200);clientCookie=clientLogin.headers.get('set-cookie').split(';')[0];
 const personalExport=await fetch(`${baseUrl}/api/client/export`,{headers:{cookie:clientCookie}});assert.equal(personalExport.status,200);assert.equal((await personalExport.json()).user.email,'http-client@example.com');assert.match(personalExport.headers.get('content-disposition'),/attachment/);
 const profile=await (await fetch(`${baseUrl}/api/client/profile`,{headers:{cookie:clientCookie}})).json();assert.equal(profile.email,'http-client@example.com');assert.equal(profile.version,1);
 const profileUpdate=await fetch(`${baseUrl}/api/client/profile`,{method:'PATCH',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:1,firstName:'Client modifié',lastName:'Test',language:'fr'})});assert.equal(profileUpdate.status,200);
 const staleProfile=await fetch(`${baseUrl}/api/client/profile`,{method:'PATCH',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:1,firstName:'Autre',lastName:'Test',language:'fr'})});assert.equal(staleProfile.status,409);
 const clientAppointments=await (await fetch(`${baseUrl}/api/client/appointments`,{headers:{cookie:clientCookie}})).json();assert.equal(clientAppointments.appointments.length,2);
 assert.deepEqual((await (await fetch(`${baseUrl}/api/client/loyalty`,{headers:{cookie:clientCookie}})).json()).rewards,[]);
 const adminClients=await fetch(`${baseUrl}/api/admin/clients?q=http-client`,{headers:{cookie}});assert.equal(adminClients.status,200);assert.equal((await adminClients.json()).clients.length,1);
 const requested=await fetch(`${baseUrl}/api/client/appointments/cancel-request-accept/cancellation`,{method:'POST',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({reason:'Empêchement'})});assert.equal(requested.status,200);assert.equal((await requested.json()).type,'REQUEST_PENDING');
 const pendingRequest=(await (await fetch(`${baseUrl}/api/admin/cancellations`,{headers:{cookie}})).json()).requests[0];assert.equal(pendingRequest.appointmentId,'cancel-request-accept');
 const acceptedCancellation=await fetch(`${baseUrl}/api/admin/cancellations/${pendingRequest.id}`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({decision:'ACCEPTED',version:pendingRequest.appointmentVersion})});assert.equal(acceptedCancellation.status,200);assert.equal((await acceptedCancellation.json()).appointmentStatus,'CANCELLED');
 const rejectedRequest=await fetch(`${baseUrl}/api/client/appointments/cancel-request-reject/cancellation`,{method:'POST',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({})});assert.equal(rejectedRequest.status,200);const rejectRequestId=(await rejectedRequest.json()).requestId;
 const rejectedCancellation=await fetch(`${baseUrl}/api/admin/cancellations/${rejectRequestId}`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({decision:'REJECTED',version:1,reason:'Rendez-vous maintenu'})});assert.equal(rejectedCancellation.status,200);assert.equal((await rejectedCancellation.json()).appointmentStatus,'PENDING');const cancellationCleanup=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{cancellationCleanup.prepare("UPDATE appointments SET status='CANCELLED' WHERE id='cancel-request-reject'").run();}finally{cancellationCleanup.close();}
 const directDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{const start=new Date(Date.now()+48*3600000),stamp=new Date().toISOString();directDb.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at) VALUES('cancel-direct','thomas-shop','coupe-classique','http-client','Client Test','http-client@example.com',?,?,'Europe/Paris','Coupe classique',500,30,'CONFIRMED',?)`).run(start.toISOString(),new Date(start.getTime()+30*60000).toISOString(),stamp);}finally{directDb.close();}
 const directCancellation=await fetch(`${baseUrl}/api/client/appointments/cancel-direct/cancellation`,{method:'POST',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({})});assert.equal(directCancellation.status,200);assert.equal((await directCancellation.json()).status,'CANCELLED');
 const passwordChange=await fetch(`${baseUrl}/api/client/password`,{method:'POST',headers:{cookie:clientCookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({currentPassword:'client-password-safe-123',newPassword:'new-client-password-safe-456'})});assert.equal(passwordChange.status,200);assert.equal((await fetch(`${baseUrl}/api/client/profile`,{headers:{cookie:clientCookie}})).status,401);
 const newClientLogin=await fetch(`${baseUrl}/api/auth/client/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'http-client@example.com',password:'new-client-password-safe-456'})});assert.equal(newClientLogin.status,200);clientCookie=newClientLogin.headers.get('set-cookie').split(';')[0];
 const dashboard=await fetch(`${baseUrl}/api/admin/dashboard`,{headers:{cookie}});assert.equal(dashboard.status,200);assert.equal((await dashboard.json()).timezone,'Europe/Paris');
 const auditDenied=await fetch(`${baseUrl}/api/admin/audit`);assert.equal(auditDenied.status,401);
 const audit=await fetch(`${baseUrl}/api/admin/audit?limit=10`,{headers:{cookie}});assert.equal(audit.status,200);assert.ok((await audit.json()).events.some(event=>event.action==='CANCELLATION_ACCEPTED'));
 const catalogResponse=await fetch(`${baseUrl}/api/admin/services`,{headers:{cookie}}),catalog=await catalogResponse.json();assert.equal(catalogResponse.status,200);
 const coupe=catalog.services.find(service=>service.id==='coupe-classique');
 const updateService=await fetch(`${baseUrl}/api/admin/services/coupe-classique`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:coupe.version,name:coupe.name,priceCents:coupe.priceCents,durationMinutes:coupe.durationMinutes,active:Boolean(coupe.active),eligible:Boolean(coupe.eligible)})});assert.equal(updateService.status,200);assert.equal((await updateService.json()).service.version,coupe.version+1);
 const createdService=await fetch(`${baseUrl}/api/admin/services`,{method:'POST',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({name:'Service temporaire de test',priceCents:900,durationMinutes:45,eligible:true})});assert.equal(createdService.status,201);const createdServiceData=(await createdService.json()).service;
 const deactivateService=await fetch(`${baseUrl}/api/admin/services/${createdServiceData.id}`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:createdServiceData.version,name:createdServiceData.name,priceCents:createdServiceData.priceCents,durationMinutes:createdServiceData.durationMinutes,active:false,eligible:true})});assert.equal(deactivateService.status,200);
 const publicCatalog=await (await fetch(`${baseUrl}/api/shop`)).json();assert.ok(!publicCatalog.services.some(service=>service.id===createdServiceData.id));
 const block=await fetch(`${baseUrl}/api/admin/unavailabilities`,{method:'POST',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({startsAt:'2040-01-07T08:00:00.000Z',endsAt:'2040-01-07T09:00:00.000Z',reason:'Indisponibilité de test'})});assert.equal(block.status,201);const blockData=await block.json();
 const removed=await fetch(`${baseUrl}/api/admin/unavailabilities/${blockData.id}`,{method:'DELETE',headers:{cookie,origin:baseUrl}});assert.equal(removed.status,200);
 const appointmentDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{appointmentDb.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at) VALUES('block-conflict','thomas-shop','coupe-classique','Test Client','test@example.com','2040-01-07T09:30:00.000Z','2040-01-07T10:00:00.000Z','Europe/Paris','Coupe classique',500,30,'CONFIRMED',?)`).run(new Date().toISOString());}finally{appointmentDb.close();}
 const hoursResponse=await fetch(`${baseUrl}/api/admin/hours`,{headers:{cookie}}),hours=await hoursResponse.json(),saturdayHours=hours.hours.find(item=>item.weekday===6);assert.equal(hoursResponse.status,200);
 const rejectedHours=await fetch(`${baseUrl}/api/admin/hours/6`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:saturdayHours.version,opens:'09:00',closes:'10:00'})});assert.equal(rejectedHours.status,409);assert.equal((await rejectedHours.json()).appointments[0].id,'block-conflict');
 const keptHours=await fetch(`${baseUrl}/api/admin/hours/6`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:saturdayHours.version,opens:'09:00',closes:'19:00'})});assert.equal(keptHours.status,200);assert.equal((await keptHours.json()).version,saturdayHours.version+1);
 const mondayHours=hours.hours.find(item=>item.weekday===1),[weekSat,weekSun]=upcomingWeekend(),mondayDate=new Date(`${weekSun}T12:00:00Z`);mondayDate.setUTCDate(mondayDate.getUTCDate()+1);const monday=mondayDate.toISOString().slice(0,10);
 const openMonday=await fetch(`${baseUrl}/api/admin/hours/1`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:mondayHours.version,opens:'10:00',closes:'11:00'})});assert.equal(openMonday.status,200);
 const mondaySlots=await (await fetch(`${baseUrl}/api/availability?service=contours&date=${monday}`)).json();assert.deepEqual(mondaySlots.slots,['10:00','10:15','10:30','10:45']);
 const restoreMonday=await fetch(`${baseUrl}/api/admin/hours/1`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:mondayHours.version+1,opens:null,closes:null})});assert.equal(restoreMonday.status,200);
 const conflict=await fetch(`${baseUrl}/api/admin/unavailabilities`,{method:'POST',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({startsAt:'2040-01-07T09:45:00.000Z',endsAt:'2040-01-07T10:15:00.000Z',reason:'Test conflit'})});assert.equal(conflict.status,409);assert.equal((await conflict.json()).appointments[0].id,'block-conflict');
 const cleanupDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{cleanupDb.prepare("DELETE FROM appointments WHERE id='block-conflict'").run();}finally{cleanupDb.close();}
 const modifyDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{const created=new Date().toISOString();modifyDb.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at) VALUES('modify-test','thomas-shop','coupe-classique','Test Client','test@example.com','2040-01-07T09:00:00.000Z','2040-01-07T09:30:00.000Z','Europe/Paris','Coupe classique',500,30,'CONFIRMED',?)`).run(created);modifyDb.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at) VALUES('modify-blocker','thomas-shop','coupe-classique','Other Client','other@example.com','2040-01-07T11:00:00.000Z','2040-01-07T11:30:00.000Z','Europe/Paris','Coupe classique',500,30,'CONFIRMED',?)`).run(created);}finally{modifyDb.close();}
 const blockedMove=await fetch(`${baseUrl}/api/admin/appointments/modify-test`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:1,serviceId:'burst-fade',date:'2040-01-07',time:'12:00'})});assert.equal(blockedMove.status,409);assert.equal((await blockedMove.json()).error,'slot_unavailable');
 const verifyOriginal=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{assert.equal(verifyOriginal.prepare("SELECT starts_at FROM appointments WHERE id='modify-test'").get().starts_at,'2040-01-07T09:00:00.000Z');}finally{verifyOriginal.close();}
 const moved=await fetch(`${baseUrl}/api/admin/appointments/modify-test`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:1,serviceId:'burst-fade',date:'2040-01-07',time:'12:30'})});assert.equal(moved.status,200);const movedData=await moved.json();assert.equal(movedData.service_name_snapshot,'Burst Fade');assert.equal(movedData.price_cents_snapshot,700);assert.equal(movedData.version,2);
 const unchanged=await fetch(`${baseUrl}/api/admin/appointments/modify-test`,{method:'PATCH',headers:{cookie,origin:baseUrl,'content-type':'application/json'},body:JSON.stringify({version:1,serviceId:'coupe-classique',date:'2040-01-07',time:'12:30'})});assert.equal(unchanged.status,409);
 const afterModifyDb=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));try{assert.equal(afterModifyDb.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE object_id='modify-test' AND action='APPOINTMENT_MODIFIED'").get().n,1);assert.equal(afterModifyDb.prepare("SELECT COUNT(*) AS n FROM notification_outbox WHERE appointment_id='modify-test' AND kind='appointment_modified:2'").get().n,1);afterModifyDb.prepare("UPDATE appointments SET status='CANCELLED' WHERE id IN ('modify-test','modify-blocker')").run();}finally{afterModifyDb.close();}
 const logout=await fetch(`${baseUrl}/api/auth/logout`,{method:'POST',headers:{cookie,origin:baseUrl}});assert.equal(logout.status,200);
 assert.equal((await fetch(`${baseUrl}/api/admin/dashboard`,{headers:{cookie}})).status,401);
 const replay=await fetch(`${baseUrl}/api/auth/admin/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'http-admin@example.com',password:'a-secure-local-test-password',otp})});
 assert.equal(replay.status,401);
});

test('public responses carry browser security headers',async()=>{
 const r=await fetch(baseUrl);assert.equal(r.status,200);
 assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 assert.equal(r.headers.get('x-frame-options'),'DENY');
 assert.match(r.headers.get('content-security-policy'),/default-src 'self'/);
 const health=await fetch(`${baseUrl}/healthz`);assert.equal(health.status,200);assert.equal((await health.json()).status,'ok');
});

test('production server refuses to start without live provider, HTTPS and MFA secrets',()=>{
 const dbPath=path.join(tempDir,'must-not-initialize.sqlite');let stderr='';
 try{execFileSync(process.execPath,[path.join(__dirname,'..','server.js')],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'production',PORT:'0',CUTLY_DB_PATH:dbPath,CUTLY_MFA_ENCRYPTION_KEY:'',RESEND_API_KEY:'',CUTLY_EMAIL_FROM:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',TWILIO_FROM:'',TWILIO_MESSAGING_SERVICE_SID:'',CUTLY_PUBLIC_BASE_URL:''},encoding:'utf8',stdio:['ignore','pipe','pipe']});}catch(error){stderr=error.stderr?.toString()||'';assert.notEqual(error.status,0);}
 assert.match(stderr,/Production requires CUTLY_MFA_ENCRYPTION_KEY/);assert.equal(fs.existsSync(dbPath),false);
});

test('notification outbox persists sanitized provider receipts from a test transport',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  const timestamp='2000-01-01T00:00:00.000Z';db.prepare("INSERT INTO notification_outbox(id,channel,kind,status,payload_json,created_at) VALUES('receipt-test','EMAIL','booking_requested:client','PENDING',?,?)").run(JSON.stringify({email:'test@example.test',service:'Coupe classique',startsAt:'2040-01-07T09:00:00.000Z',timezone:'Europe/Paris'}),timestamp);
  const calls=[];const result=await processOutbox(db,{now:new Date(),limit:1,deliver:async message=>{calls.push(message);return {provider:'test-transport',id:'test-message-id',status:'ACCEPTED'};}});
  assert.ok(result.processed>=1);assert.ok(calls.length>=1);const row=db.prepare("SELECT status,provider_name,provider_message_id,provider_status,attempts,last_error FROM notification_outbox WHERE id='receipt-test'").get();assert.deepEqual(Object.values(row),['SENT','test-transport','test-message-id','ACCEPTED',1,null]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=6').get().count,1);
 }finally{db.close();}
});

test('appointment SMS notifications remain opt-in and unknown delivery outcomes are not retried',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  const text=template({channel:'SMS',kind:'appointment_status:CONFIRMED',payload_json:JSON.stringify({phone:'+33612345678',service:'Coupe classique',startsAt:'2040-01-07T09:00:00.000Z',timezone:'Europe/Paris'})});assert.equal(text.to,'+33612345678');assert.match(text.text,/confirmé/);
  db.prepare("INSERT INTO notification_outbox(id,channel,kind,status,payload_json,created_at) VALUES('sms-uncertain-test','SMS','appointment_status:CONFIRMED','PENDING',?,?)").run(JSON.stringify({phone:'+33612345678',service:'Coupe classique',startsAt:'2040-01-07T09:00:00.000Z',timezone:'Europe/Paris'}),'2000-01-01T00:00:00.000Z');
  await processOutbox(db,{limit:1,deliver:async()=>{const error=new Error('sms_provider_outcome_unknown');error.code='sms_provider_outcome_unknown';throw error;}});
  const row=db.prepare("SELECT status,attempts,next_attempt_at,provider_status,last_error FROM notification_outbox WHERE id='sms-uncertain-test'").get();assert.equal(row.status,'FAILED');assert.equal(row.attempts,1);assert.equal(row.next_attempt_at,null);assert.equal(row.provider_status,'FAILED');assert.equal(row.last_error,'sms_provider_outcome_unknown');
 }finally{db.close();}
});

test('local SQLite backup creates a new file and verifies integrity without replacing it',()=>{
 const destination=path.join(tempDir,'verified-backup.sqlite');
 const output=execFileSync(process.execPath,[path.join(__dirname,'..','scripts','backup-db.js'),destination],{cwd:path.join(__dirname,'..'),env:{...process.env,CUTLY_DB_PATH:path.join(tempDir,'cutly.sqlite')},encoding:'utf8'});
 assert.match(output,/"status":"verified"/);const copy=new DatabaseSync(destination,{readOnly:true});try{assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copy.prepare("SELECT COUNT(*) AS count FROM establishments WHERE id='thomas-shop'").get().count,1);assert.throws(()=>execFileSync(process.execPath,[path.join(__dirname,'..','scripts','backup-db.js'),destination],{cwd:path.join(__dirname,'..'),env:{...process.env,CUTLY_DB_PATH:path.join(tempDir,'cutly.sqlite')},encoding:'utf8',stdio:'pipe'}));}finally{copy.close();}
 const restoredPath=path.join(tempDir,'restored.sqlite');fs.copyFileSync(destination,restoredPath);const restored=new DatabaseSync(restoredPath,{readOnly:true});try{assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(restored.prepare("SELECT COUNT(*) AS count FROM establishments WHERE id='thomas-shop'").get().count,1);}finally{restored.close();}
});

test('SQLite rejects overlapping active appointments at the data boundary',()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');
  const add=db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at)
   VALUES(?, 'thomas-shop','coupe-classique','Test Client','test@example.com',?,?,'Europe/Paris','Coupe classique',500,30,?,?)`);
  const first='2030-01-05T12:00:00.000Z';
  add.run('appt-one',first,'2030-01-05T12:30:00.000Z','PENDING',new Date().toISOString());
  assert.throws(()=>add.run('appt-two','2030-01-05T12:15:00.000Z','2030-01-05T12:45:00.000Z','CONFIRMED',new Date().toISOString()),/appointment_overlap/);
  assert.doesNotThrow(()=>add.run('appt-rejected','2030-01-05T12:15:00.000Z','2030-01-05T12:45:00.000Z','REJECTED',new Date().toISOString()));
 }finally{db.close();}
});

test('availability suppresses slots blocked by a Thomas Shop unavailability',async()=>{
 const [saturday]=upcomingWeekend();const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{db.prepare("INSERT INTO unavailability(id,establishment_id,starts_at,ends_at,created_at) VALUES('block-am','thomas-shop',?,?,?)").run(`${saturday}T00:00:00.000Z`,`${saturday}T12:00:00.000Z`,new Date().toISOString());}
 finally{db.close();}
 const result=await (await fetch(`${baseUrl}/api/availability?service=contours&date=${saturday}`)).json();
 assert.ok(!result.slots.includes('09:00'));assert.ok(result.slots.includes('14:00'));
});

test('booking service requires verified identity and creates an idempotent historical snapshot atomically',async()=>{
 const [saturday]=upcomingWeekend(1);const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');
  const now=new Date();
  db.prepare(`INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,phone_verified_at,created_at,updated_at)
   VALUES('verified-client','verified@example.com','+33612345678','Camille','Martin','test-hash',?,?,?,?)`).run(now.toISOString(),now.toISOString(),now.toISOString(),now.toISOString());
  db.prepare(`INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,created_at,updated_at)
   VALUES('unverified-client','unverified@example.com','+33612345679','Alex','Durand','test-hash',?,?,?)`).run(now.toISOString(),now.toISOString(),now.toISOString());
  const input={userId:'verified-client',serviceId:'coupe-classique',date:saturday,time:'09:00',idempotencyKey:'booking-test-key-0001',now},previousSmsSetting=process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS='true';
  const first=await createBooking(db,input),retry=await createBooking(db,input);if(previousSmsSetting===undefined)delete process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;else process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS=previousSmsSetting;
  assert.deepEqual(retry,first);assert.equal(first.status,'PENDING');assert.equal(first.priceCents,500);assert.equal(first.durationMinutes,30);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM appointments WHERE id=?').get(first.id).count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE appointment_id=? AND channel='SMS' AND kind='booking_requested:client'").get(first.id).count,1);
  const snapshot=db.prepare('SELECT service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot FROM appointments WHERE id=?').get(first.id);
  assert.deepEqual(Object.values(snapshot),['Coupe classique',500,30]);
  await assert.rejects(()=>createBooking(db,{...input,userId:'unverified-client',idempotencyKey:'booking-test-key-0002'}),e=>e instanceof BookingError&&e.code==='account_verification_required');
  await assert.rejects(()=>createBooking(db,{...input,time:'09:15',idempotencyKey:'booking-test-key-0003'}),e=>e instanceof BookingError&&e.code==='slot_unavailable');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE client_email='verified@example.com'").get().count,1);
 }finally{db.close();}
});

test('appointment decisions enforce admin membership, transition rules, versions, audit and outbox',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date().toISOString();
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at)
   VALUES('shop-admin','admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)`).run(now,now);
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,created_at,updated_at)
   VALUES('appointment-client','customer@example.com','Camille','Martin','test-hash',?,?)`).run(now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('shop-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at)
   VALUES('transition-test','thomas-shop','coupe-classique','Camille Martin','customer@example.com','2032-01-03T08:00:00.000Z','2032-01-03T08:30:00.000Z','Europe/Paris','Coupe classique',500,30,'PENDING',?)`).run(now);
  await assert.rejects(()=>transitionAppointment(db,{appointmentId:'transition-test',actorId:'appointment-client',to:'CONFIRMED',expectedVersion:1}),e=>e instanceof AppointmentError&&e.code==='forbidden');
  const confirmed=await transitionAppointment(db,{appointmentId:'transition-test',actorId:'shop-admin',to:'CONFIRMED',expectedVersion:1,now:new Date()});
  assert.equal(confirmed.status,'CONFIRMED');assert.equal(confirmed.version,2);assert.equal(confirmed.payment_status,'UNPAID');
  await assert.rejects(()=>transitionAppointment(db,{appointmentId:'transition-test',actorId:'shop-admin',to:'COMPLETED',expectedVersion:1}),e=>e instanceof AppointmentError&&e.code==='version_conflict');
  const completed=await transitionAppointment(db,{appointmentId:'transition-test',actorId:'shop-admin',to:'COMPLETED',expectedVersion:2});
  assert.equal(completed.status,'COMPLETED');assert.equal(completed.payment_status,'UNPAID');
  await assert.rejects(()=>transitionAppointment(db,{appointmentId:'transition-test',actorId:'shop-admin',to:'CONFIRMED',expectedVersion:3}),e=>e instanceof AppointmentError&&e.code==='invalid_transition');
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE object_id='transition-test'").get().count,2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE appointment_id='transition-test' AND kind LIKE 'appointment_status:%'").get().count,2);
 }finally{db.close();}
});

test('loyalty awards only completed, paid, eligible services and issues one reward at ten points',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date().toISOString();
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at)
   VALUES('loyalty-admin','loyalty-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)`).run(now,now);
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,created_at,updated_at)
   VALUES('loyalty-client','loyalty-client@example.com','Sam','Client','test-hash',?,?)`).run(now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('loyalty-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  const add=db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,loyalty_eligible_snapshot,status,payment_status,created_at)
   VALUES(?,'thomas-shop','coupe-classique','loyalty-client','Sam Client','loyalty-client@example.com',? ,?,'Europe/Paris','Coupe classique',500,30,1,'COMPLETED','PAID',?)`);
  for(let i=0;i<10;i++){const start=new Date(Date.UTC(2035,0,i+1,9)).toISOString();add.run(`loyalty-${i}`,start,new Date(Date.parse(start)+30*60000).toISOString(),now);}
  let result;
  for(let i=0;i<9;i++){result=await reconcileCompletedPaidAppointment(db,{appointmentId:`loyalty-${i}`,actorId:'loyalty-admin'});assert.equal(result.points,i+1);assert.equal(result.reward,null);}
  result=await reconcileCompletedPaidAppointment(db,{appointmentId:'loyalty-9',actorId:'loyalty-admin'});
  assert.equal(result.points,10);assert.equal(result.reward.status,'AVAILABLE');assert.equal(result.cycle,1);
  assert.equal((await reconcileCompletedPaidAppointment(db,{appointmentId:'loyalty-9',actorId:'loyalty-admin'})).reason,'already_earned');
  const reward=db.prepare('SELECT status,cycle_number FROM rewards WHERE id=?').get(result.reward.id);
  assert.deepEqual(Object.values(reward),['AVAILABLE',1]);
  db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,loyalty_eligible_snapshot,status,payment_status,created_at)
   VALUES('loyalty-contours','thomas-shop','contours','loyalty-client','Sam Client','loyalty-client@example.com','2035-02-01T09:00:00.000Z','2035-02-01T09:15:00.000Z','Europe/Paris','Contours',500,15,0,'COMPLETED','PAID',?)`).run(now);
  assert.equal((await reconcileCompletedPaidAppointment(db,{appointmentId:'loyalty-contours',actorId:'loyalty-admin'})).reason,'not_eligible');
  db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,loyalty_eligible_snapshot,status,payment_status,created_at)
   VALUES('loyalty-unpaid','thomas-shop','coupe-classique','loyalty-client','Sam Client','loyalty-client@example.com','2035-02-02T09:00:00.000Z','2035-02-02T09:30:00.000Z','Europe/Paris','Coupe classique',500,30,1,'COMPLETED','UNPAID',?)`).run(now);
  await assert.rejects(()=>reconcileCompletedPaidAppointment(db,{appointmentId:'loyalty-unpaid',actorId:'loyalty-admin'}),e=>e instanceof LoyaltyError&&e.code==='completion_and_payment_required');
  await assert.rejects(()=>reconcileCompletedPaidAppointment(db,{appointmentId:'nonexistent',actorId:'loyalty-admin'}),e=>e instanceof LoyaltyError&&e.code==='appointment_not_found');
 }finally{db.close();}
});

test('onsite payment records only completed appointments at their historical amount',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date().toISOString();
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at)
   VALUES('payment-admin','payment-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)`).run(now,now);
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,created_at,updated_at)
   VALUES('payment-client','payment-client@example.com','Alex','Client','test-hash',?,?)`).run(now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('payment-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  const insert=db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,payment_status,created_at)
   VALUES(?,'thomas-shop','coupe-classique','payment-client','Client Test','payment-client@example.com','2036-01-05T08:00:00.000Z','2036-01-05T08:30:00.000Z','Europe/Paris','Coupe classique',500,30,?,'UNPAID',?)`);
  insert.run('payment-completed','COMPLETED',now);insert.run('payment-pending','PENDING',now);
  const paid=await recordOnsitePayment(db,{appointmentId:'payment-completed',actorId:'payment-admin',expectedVersion:1,amountCents:500,method:'Espèces'});
  assert.equal(paid.status,'PAID');assert.equal(paid.amountCents,500);assert.equal(paid.version,2);
  assert.equal(paid.loyalty.awarded,true);assert.equal(paid.loyalty.points,1);
  const state=db.prepare('SELECT status,payment_status,version FROM appointments WHERE id=?').get('payment-completed');
  assert.deepEqual(Object.values(state),['COMPLETED','PAID',2]);
  await assert.rejects(()=>recordOnsitePayment(db,{appointmentId:'payment-completed',actorId:'payment-admin',expectedVersion:2,amountCents:500}),e=>e instanceof PaymentError&&e.code==='payment_not_unpaid');
  await assert.rejects(()=>recordOnsitePayment(db,{appointmentId:'payment-pending',actorId:'payment-admin',expectedVersion:1,amountCents:500}),e=>e instanceof PaymentError&&e.code==='appointment_not_completed');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payment_events WHERE appointment_id=?').get('payment-completed').count,1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM loyalty_ledger WHERE appointment_id='payment-completed' AND kind='EARN'").get().count,1);
 }finally{db.close();}
});

test('payment corrections require a reason and preserve the original payment event',async()=>{
 const isolated=path.join(tempDir,'payment-correction.sqlite');fs.copyFileSync(path.join(tempDir,'cutly.sqlite'),isolated);const db=new DatabaseSync(isolated);
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date().toISOString();
  db.prepare("INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES('correct-admin','correct-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)").run(now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('correct-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  db.prepare("INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES('correct-client','correct-client@example.com','Alex','Client','test-hash','CLIENT',?,?)").run(now,now);
  db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,payment_status,created_at)
   VALUES('correct-payment','thomas-shop','coupe-classique','correct-client','Alex Client','correct-client@example.com','2036-01-05T08:00:00.000Z','2036-01-05T08:30:00.000Z','Europe/Paris','Coupe classique',500,30,'COMPLETED','UNPAID',?)`).run(now);
  const paid=await recordOnsitePayment(db,{appointmentId:'correct-payment',actorId:'correct-admin',expectedVersion:1,amountCents:500,now:new Date(now)});
  await assert.rejects(()=>correctOnsitePayment(db,{appointmentId:'correct-payment',actorId:'correct-admin',expectedVersion:paid.version,amountCents:450}),e=>e instanceof PaymentError&&e.code==='reason_required');
  const corrected=await correctOnsitePayment(db,{appointmentId:'correct-payment',actorId:'correct-admin',expectedVersion:paid.version,amountCents:450,reason:'Erreur de saisie',now:new Date(Date.parse(now)+1000)});
  assert.equal(corrected.correctionOf,paid.id);assert.equal(corrected.version,3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payment_events WHERE appointment_id=?').get('correct-payment').count,2);
  assert.equal(db.prepare('SELECT amount_cents FROM payment_events WHERE id=?').get(paid.id).amount_cents,500);
  const event=db.prepare('SELECT status,amount_cents,actor_id,reason,correction_of FROM payment_events WHERE id=?').get(corrected.id);
  assert.deepEqual(Object.values(event),['CORRECTION',450,'correct-admin','Erreur de saisie',paid.id]);
  assert.equal((await getDashboardSummary(db,{actorId:'correct-admin',now:new Date(Date.parse(now)+2000)})).revenueCents,450);
 }finally{db.close();}
});

test('only completed appointment owners can submit one pending review; Thomas decisions are audited',async()=>{
 const isolated=path.join(tempDir,'review-moderation.sqlite');fs.copyFileSync(path.join(tempDir,'cutly.sqlite'),isolated);const db=new DatabaseSync(isolated);
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date().toISOString();
  db.prepare("INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES('review-client','review-client@example.com','Riley','Client','test-hash','CLIENT',?,?)").run(now,now);
  db.prepare("INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at) VALUES('review-admin','review-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)").run(now,now);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('review-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,payment_status,created_at)
   VALUES('review-completed','thomas-shop','coupe-classique','review-client','Riley Client','review-client@example.com','2036-01-05T08:00:00.000Z','2036-01-05T08:30:00.000Z','Europe/Paris','Coupe classique',500,30,'COMPLETED','PAID',?)`).run(now);
  await assert.rejects(()=>submitReview(db,{appointmentId:'review-completed',userId:'someone-else',rating:5}),e=>e instanceof ReviewError&&e.code==='appointment_not_found');
  const review=await submitReview(db,{appointmentId:'review-completed',userId:'review-client',rating:5,comment:'Très bien',now:new Date(now)});
  assert.equal(review.status,'PENDING_MODERATION');await assert.rejects(()=>submitReview(db,{appointmentId:'review-completed',userId:'review-client',rating:4}),e=>e instanceof ReviewError&&e.code==='review_already_submitted');
  assert.equal((await decideReview(db,{reviewId:review.id,actorId:'review-admin',decision:'PUBLISHED'})).status,'PUBLISHED');
  assert.equal(db.prepare("SELECT action FROM audit_events WHERE object_type='REVIEW' AND object_id=? AND action='REVIEW_APPROVED'").get(review.id).action,'REVIEW_APPROVED');
  await assert.rejects(()=>decideReview(db,{reviewId:review.id,actorId:'review-admin',decision:'HIDDEN'}),e=>e instanceof ReviewError&&e.code==='reason_required');
 }finally{db.close();}
});

test('dashboard summary uses real establishment data and rejects non-admins',async()=>{
 const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date('2037-04-03T12:00:00.000Z'),createdAt=now.toISOString();
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at)
   VALUES('dashboard-admin','dashboard-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)`).run(createdAt,createdAt);
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,created_at,updated_at)
   VALUES('dashboard-client','dashboard-client@example.com','Jordan','Client','test-hash',?,?)`).run(createdAt,createdAt);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('dashboard-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  const dayStart=parisToUTC('2037-04-03','00:00').getTime();
  const add=db.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_user_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,payment_status,created_at)
   VALUES(?,'thomas-shop','coupe-classique','dashboard-client','Jordan Client','dashboard-client@example.com',?,?,'Europe/Paris','Coupe classique',500,30,?,?,?)`);
  const slots=[['dash-confirmed',dayStart+8*3600000,'CONFIRMED','UNPAID'],['dash-completed',dayStart+9*3600000,'COMPLETED','PAID'],['dash-cancelled',dayStart+10*3600000,'CANCELLED','UNPAID'],['dash-noshow',dayStart+11*3600000,'NO_SHOW','UNPAID'],['dash-pending',dayStart+25*3600000,'PENDING','UNPAID']];
  for(const [id,start,status,payment] of slots){const begin=new Date(start).toISOString();add.run(id,begin,new Date(start+30*60000).toISOString(),status,payment,createdAt);}
  db.prepare("INSERT INTO payment_events(id,appointment_id,status,amount_cents,actor_id,created_at) VALUES('dash-pay','dash-completed','PAID',500,'dashboard-admin',?)").run(createdAt);
  const summary=await getDashboardSummary(db,{actorId:'dashboard-admin',now});
  assert.deepEqual(summary.appointments,{today:4,upcomingPending:1,upcomingConfirmed:0,completed:1,cancelled:1,noShow:1,pendingCancellationRequests:0});
  assert.equal(summary.revenueCents,500);assert.equal(summary.clients,5);assert.equal(summary.timezone,'Europe/Paris');
  await assert.rejects(()=>getDashboardSummary(db,{actorId:'dashboard-client',now}),e=>e instanceof DashboardError&&e.code==='forbidden');
 }finally{db.close();}
});

test('reward reservations restore on rejection and NO_SHOW, and consume only on completion',async()=>{
 const [saturday]=upcomingWeekend(2);const db=new DatabaseSync(path.join(tempDir,'cutly.sqlite'));
 try{
  db.exec('PRAGMA foreign_keys=ON');const now=new Date(),stamp=now.toISOString();
  db.prepare(`INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,phone_verified_at,role,created_at,updated_at)
   VALUES('reward-client','reward-client@example.com','+33612345670','Riley','Client','test-hash',?,?,'CLIENT',?,?)`).run(stamp,stamp,stamp,stamp);
  db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,role,created_at,updated_at)
   VALUES('reward-admin','reward-admin@example.com','Thomas','Shop','test-hash','ESTABLISHMENT_ADMIN',?,?)`).run(stamp,stamp);
  db.prepare("INSERT INTO establishment_members(user_id,establishment_id,role) VALUES('reward-admin','thomas-shop','ESTABLISHMENT_ADMIN')").run();
  db.prepare("INSERT INTO rewards(id,user_id,cycle_number,status,earned_at) VALUES('reward-one','reward-client',1,'AVAILABLE',?)").run(stamp);
  const first=await createBooking(db,{userId:'reward-client',serviceId:'coupe-classique',date:saturday,time:'09:00',rewardId:'reward-one',idempotencyKey:'reward-booking-key-001'});
  assert.equal(first.rewardId,'reward-one');
  assert.equal(db.prepare('SELECT payment_status FROM appointments WHERE id=?').get(first.id).payment_status,'NOT_APPLICABLE');
  assert.equal(db.prepare('SELECT status FROM rewards WHERE id=?').get('reward-one').status,'RESERVED');
  await transitionAppointment(db,{appointmentId:first.id,actorId:'reward-admin',to:'REJECTED',expectedVersion:1,reason:'Créneau indisponible'});
  assert.equal(db.prepare('SELECT status FROM rewards WHERE id=?').get('reward-one').status,'AVAILABLE');
  const second=await createBooking(db,{userId:'reward-client',serviceId:'coupe-classique',date:saturday,time:'09:00',rewardId:'reward-one',idempotencyKey:'reward-booking-key-002'});
  await transitionAppointment(db,{appointmentId:second.id,actorId:'reward-admin',to:'CONFIRMED',expectedVersion:1});
  const completed=await transitionAppointment(db,{appointmentId:second.id,actorId:'reward-admin',to:'COMPLETED',expectedVersion:2});
  assert.equal(completed.payment_status,'NOT_APPLICABLE');
  assert.deepEqual(Object.values(db.prepare('SELECT status,used_appointment_id FROM rewards WHERE id=?').get('reward-one')),['USED',second.id]);
  db.prepare("INSERT INTO rewards(id,user_id,cycle_number,status,earned_at) VALUES('reward-two','reward-client',2,'AVAILABLE',?)").run(stamp);
  const noShowBooking=await createBooking(db,{userId:'reward-client',serviceId:'coupe-classique',date:saturday,time:'10:00',rewardId:'reward-two',idempotencyKey:'reward-booking-key-003'});
  await transitionAppointment(db,{appointmentId:noShowBooking.id,actorId:'reward-admin',to:'CONFIRMED',expectedVersion:1});
  await transitionAppointment(db,{appointmentId:noShowBooking.id,actorId:'reward-admin',to:'NO_SHOW',expectedVersion:2,reason:'Client absent'});
  assert.equal(db.prepare('SELECT status FROM rewards WHERE id=?').get('reward-two').status,'AVAILABLE');
  assert.equal(db.prepare('SELECT used_appointment_id FROM rewards WHERE id=?').get('reward-two').used_appointment_id,null);
 }finally{db.close();}
});

test('PostgreSQL adapter translates SQLite placeholders without rewriting literals or comments',()=>{
 assert.equal(parameterize("SELECT '?', \"?\" FROM item WHERE id=? -- ?\nAND status='ready?'"),"SELECT '?', \"?\" FROM item WHERE id=$1 -- ?\nAND status='ready?'");
 assert.equal(postgresSql('INSERT OR IGNORE INTO items(id) VALUES(?)'),'INSERT INTO items(id) VALUES($1) ON CONFLICT DO NOTHING');
 assert.equal(postgresSql('INSERT OR IGNORE INTO items(id) VALUES(?);'),'INSERT INTO items(id) VALUES($1) ON CONFLICT DO NOTHING');
});

test('database adapter rolls back a nested savepoint and continues the outer transaction',async()=>{
 const db=createDatabase({sqlitePath:path.join(tempDir,'savepoints.sqlite')});
 try{
  await db.exec('CREATE TABLE savepoint_probe(id INTEGER PRIMARY KEY)');
  await db.transaction(async tx=>{
   await tx.prepare('INSERT INTO savepoint_probe(id) VALUES(?)').run(1);
   await assert.rejects(tx.transaction(async nested=>{
    await nested.prepare('INSERT INTO savepoint_probe(id) VALUES(?)').run(2);
    throw new Error('rollback nested work');
   }),/rollback nested work/);
   await tx.prepare('INSERT INTO savepoint_probe(id) VALUES(?)').run(3);
  });
  assert.deepEqual((await db.prepare('SELECT id FROM savepoint_probe ORDER BY id').all()).map(row=>row.id),[1,3]);
 }finally{await db.close();}
});

test('SQLite to PostgreSQL migration backup is new, readable, and never overwrites an existing file',()=>{
 const source=path.join(tempDir,'migration-source.sqlite'),backup=path.join(tempDir,'migration-copy.sqlite');
 const db=new DatabaseSync(source);db.exec('CREATE TABLE sample(id TEXT PRIMARY KEY); INSERT INTO sample VALUES(\'safe\')');db.close();
 assert.equal(makeBackup(source,backup),backup);
 const copy=new DatabaseSync(backup,{readOnly:true});try{assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copy.prepare('SELECT id FROM sample').get().id,'safe');}finally{copy.close();}
 assert.throws(()=>makeBackup(source,backup),/backup_already_exists/);
});

test('simultaneous bookings for one provider serialize and only one request receives the slot',async()=>{
 const source=path.join(tempDir,'cutly.sqlite'),isolated=path.join(tempDir,'concurrent-booking.sqlite');fs.copyFileSync(source,isolated);
 const db=createDatabase({sqlitePath:isolated}),stamp=new Date().toISOString(),clientId='concurrent-client';
 try{
  await db.prepare(`INSERT INTO users(id,email,first_name,last_name,password_hash,email_verified_at,phone_verified_at,role,created_at,updated_at) VALUES(?,?, 'Concurrent','Client','test-hash',?,?,'CLIENT',?,?)`).run(clientId,'concurrent@example.test',stamp,stamp,stamp,stamp);
  const [saturday]=upcomingWeekend(2),results=await Promise.allSettled([
   createBooking(db,{userId:clientId,serviceId:'coupe-classique',date:saturday,time:'09:00',idempotencyKey:'concurrent-booking-key-0001'}),
   createBooking(db,{userId:clientId,serviceId:'coupe-classique',date:saturday,time:'09:00',idempotencyKey:'concurrent-booking-key-0002'})
  ]);
  assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
  assert.equal(results.filter(result=>result.status==='rejected'&&result.reason.code==='slot_unavailable').length,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM appointments WHERE client_user_id=? AND status='PENDING'").get(clientId)).count,1);
 }finally{await db.close();}
});
