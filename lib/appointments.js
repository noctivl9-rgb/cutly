const crypto=require('node:crypto');
const {parisToUTC}=require('./booking');
const {refreshAppointmentReminders,enqueueClientSms}=require('./notifications');
const {withTransaction}=require('./database');

const TRANSITIONS={
 PENDING:new Set(['CONFIRMED','REJECTED','CANCELLED']),
 CONFIRMED:new Set(['CANCELLED','COMPLETED','NO_SHOW']),
 REJECTED:new Set(),CANCELLED:new Set(),COMPLETED:new Set(),NO_SHOW:new Set()
};
class AppointmentError extends Error{constructor(code,status=409){super(code);this.name='AppointmentError';this.code=code;this.status=status;}}

async function transitionAppointment(db,{appointmentId,actorId,to,expectedVersion,reason=null,now=new Date()}){
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new AppointmentError('version_required',400);
 if(!Object.hasOwn(TRANSITIONS,to))throw new AppointmentError('invalid_status',400);
 return withTransaction(db,async tx=>{
  const appointment=await tx.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);
  if(!appointment)throw new AppointmentError('appointment_not_found',404);
  if(appointment.version!==expectedVersion)throw new AppointmentError('version_conflict',409);
  const actor=await tx.prepare('SELECT id,email,role,disabled_at FROM users WHERE id=?').get(actorId);
  if(!actor||actor.disabled_at||actor.role!=='ESTABLISHMENT_ADMIN')throw new AppointmentError('forbidden',403);
  const membership=await tx.prepare("SELECT 1 AS allowed FROM establishment_members WHERE user_id=? AND establishment_id=? AND role='ESTABLISHMENT_ADMIN' AND active=1").get(actorId,appointment.establishment_id);
  if(!membership)throw new AppointmentError('forbidden',403);
  if(!TRANSITIONS[appointment.status]?.has(to))throw new AppointmentError('invalid_transition',409);
  if((to==='REJECTED'||to==='NO_SHOW')&&(!reason||!String(reason).trim()))throw new AppointmentError('reason_required',400);
  let reward=null;
  if(appointment.reward_id){reward=await tx.prepare('SELECT * FROM rewards WHERE id=?').get(appointment.reward_id);if(!reward||reward.status!=='RESERVED')throw new AppointmentError('reward_state_conflict',409);}
  const updatedAt=now.toISOString(),nextVersion=appointment.version+1,freeAfterReward=Boolean(reward&&to==='COMPLETED'),paymentStatus=freeAfterReward?'NOT_APPLICABLE':appointment.payment_status;
  const result=await tx.prepare('UPDATE appointments SET status=?,payment_status=?,version=? WHERE id=? AND version=?').run(to,paymentStatus,nextVersion,appointmentId,expectedVersion);
  if(result.changes!==1)throw new AppointmentError('version_conflict',409);
  if(reward){
   let nextRewardStatus=null;
   if(to==='REJECTED'||to==='CANCELLED'||to==='NO_SHOW')nextRewardStatus='AVAILABLE';
   else if(to==='COMPLETED')nextRewardStatus='USED';
   if(nextRewardStatus){
    const rewardResult=await tx.prepare("UPDATE rewards SET status=?,used_appointment_id=?,used_at=? WHERE id=? AND status='RESERVED'").run(nextRewardStatus,nextRewardStatus==='USED'?appointmentId:null,nextRewardStatus==='USED'?updatedAt:null,reward.id);
    if(rewardResult.changes!==1)throw new AppointmentError('reward_state_conflict',409);
    await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at)
     VALUES(?,?,?,?,?, ?,?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),actorId,appointment.establishment_id,`REWARD_${nextRewardStatus}`,'REWARD',reward.id,JSON.stringify({status:'RESERVED',appointmentId}),JSON.stringify({status:nextRewardStatus,appointmentId:nextRewardStatus==='USED'?appointmentId:null}),reason,updatedAt);
   }
  }
  const after={status:to,version:nextVersion};
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,reason,result,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),actorId,appointment.establishment_id,`APPOINTMENT_${to}`,'APPOINTMENT',appointmentId,JSON.stringify({status:appointment.status,version:appointment.version}),JSON.stringify(after),reason,updatedAt);
  const client=await tx.prepare('SELECT email FROM users WHERE lower(email)=lower(?)').get(appointment.client_email);
  if(client){
   const payload={appointmentId,email:client.email,status:to,service:appointment.service_name_snapshot,startsAt:appointment.starts_at,timezone:appointment.timezone};
   await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at)
    VALUES(?,?,'EMAIL',?,'PENDING',?,?)`).run(crypto.randomUUID(),appointmentId,`appointment_status:${to}`,JSON.stringify(payload),updatedAt);
   await enqueueClientSms(tx,appointment,`appointment_status:${to}`,{decision:to},updatedAt);
  }
  await refreshAppointmentReminders(tx,{...appointment,status:to,version:nextVersion});
  return {...appointment,status:to,payment_status:paymentStatus,version:nextVersion,updatedAt};
 });
}

async function modifyAppointment(db,{appointmentId,actorId,expectedVersion,serviceId,date,time,now=new Date()}){
 if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)throw new AppointmentError('version_required',400);
 return withTransaction(db,async tx=>{
  const appointment=await tx.prepare('SELECT * FROM appointments WHERE id=?').get(appointmentId);if(!appointment)throw new AppointmentError('appointment_not_found',404);
  await tx.lock?.(`appointment-space:${appointment.establishment_id}`);
  if(appointment.version!==expectedVersion)throw new AppointmentError('version_conflict',409);
  if(!['PENDING','CONFIRMED'].includes(appointment.status))throw new AppointmentError('appointment_not_modifiable',409);
  const actor=await tx.prepare('SELECT id,role,disabled_at FROM users WHERE id=?').get(actorId);
  const member=actor&&!actor.disabled_at&&actor.role==='ESTABLISHMENT_ADMIN'&&await tx.prepare("SELECT 1 FROM establishment_members WHERE user_id=? AND establishment_id=? AND role='ESTABLISHMENT_ADMIN' AND active=1").get(actorId,appointment.establishment_id);
  if(!member)throw new AppointmentError('forbidden',403);
  const service=await tx.prepare('SELECT id,establishment_id,name,price_cents,duration_minutes,active,eligible FROM services WHERE id=? AND establishment_id=?').get(serviceId,appointment.establishment_id);
  if(!service||!service.active)throw new AppointmentError('service_unavailable',404);
  if(appointment.reward_id&&service.id!=='coupe-classique')throw new AppointmentError('reward_requires_classic_cut',409);
  if(typeof time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))throw new AppointmentError('invalid_time',400);
  const start=parisToUTC(date,time);if(!start||start<=now)throw new AppointmentError('invalid_or_past_slot',409);
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay(),hours=await tx.prepare('SELECT opens,closes FROM opening_hours WHERE establishment_id=? AND weekday=?').get(appointment.establishment_id,weekday);
  if(!hours?.opens||!hours.closes)throw new AppointmentError('outside_opening_hours',409);
  const startsAtMinute=Number(time.slice(0,2))*60+Number(time.slice(3,5)),[openHour,openMinute]=hours.opens.split(':').map(Number),[closeHour,closeMinute]=hours.closes.split(':').map(Number),endMinute=startsAtMinute+service.duration_minutes;
  if(startsAtMinute%15!==0||startsAtMinute<openHour*60+openMinute||endMinute>closeHour*60+closeMinute)throw new AppointmentError('outside_opening_hours',409);
  const end=new Date(start.getTime()+service.duration_minutes*60000),startIso=start.toISOString(),endIso=end.toISOString();
  const conflict=await tx.prepare(`SELECT id FROM appointments WHERE establishment_id=? AND id<>? AND status IN ('PENDING','CONFIRMED') AND starts_at<? AND ends_at>?
   UNION ALL SELECT id FROM unavailability WHERE establishment_id=? AND starts_at<? AND ends_at>? LIMIT 1`).get(appointment.establishment_id,appointmentId,endIso,startIso,appointment.establishment_id,endIso,startIso);
  if(conflict)throw new AppointmentError('slot_unavailable',409);
  const price=appointment.reward_id?0:service.price_cents,version=appointment.version+1,updatedAt=now.toISOString();
  const changed=await tx.prepare(`UPDATE appointments SET service_id=?,service_name_snapshot=?,price_cents_snapshot=?,duration_minutes_snapshot=?,loyalty_eligible_snapshot=?,starts_at=?,ends_at=?,version=? WHERE id=? AND version=?`).run(service.id,service.name,price,service.duration_minutes,service.eligible,startIso,endIso,version,appointmentId,expectedVersion);
  if(changed.changes!==1)throw new AppointmentError('version_conflict',409);
  const before={serviceId:appointment.service_id,serviceName:appointment.service_name_snapshot,priceCents:appointment.price_cents_snapshot,durationMinutes:appointment.duration_minutes_snapshot,startsAt:appointment.starts_at,endsAt:appointment.ends_at,version:appointment.version};
  const after={serviceId:service.id,serviceName:service.name,priceCents:price,durationMinutes:service.duration_minutes,startsAt:startIso,endsAt:endIso,version};
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,result,created_at) VALUES(?,?,?,'APPOINTMENT_MODIFIED','APPOINTMENT',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),actorId,appointment.establishment_id,appointmentId,JSON.stringify(before),JSON.stringify(after),updatedAt);
  await tx.prepare(`INSERT OR IGNORE INTO notification_outbox(id,appointment_id,channel,kind,status,payload_json,created_at) VALUES(?,?,'EMAIL',?,'PENDING',?,?)`).run(crypto.randomUUID(),appointmentId,`appointment_modified:${version}`,JSON.stringify({appointmentId,email:appointment.client_email,service:service.name,startsAt:startIso,timezone:'Europe/Paris',version}),updatedAt);
  await enqueueClientSms(tx,{...appointment,service_name_snapshot:service.name,starts_at:startIso},`appointment_modified:${version}`,{},updatedAt);
  await refreshAppointmentReminders(tx,{...appointment,status:appointment.status,version,starts_at:startIso,ends_at:endIso,service_name_snapshot:service.name});
  return {...appointment,service_id:service.id,service_name_snapshot:service.name,price_cents_snapshot:price,duration_minutes_snapshot:service.duration_minutes,loyalty_eligible_snapshot:service.eligible,starts_at:startIso,ends_at:endIso,version,updatedAt};
 });
}

module.exports={AppointmentError,transitionAppointment,modifyAppointment,TRANSITIONS};
