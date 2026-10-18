const crypto=require('node:crypto');
const {hashPassword,mfaKey}=require('./auth');
const {withTransaction}=require('./database');
const {enqueueEmail}=require('./notifications');

class AccountError extends Error{constructor(code,status=400){super(code);this.name='AccountError';this.code=code;this.status=status;}}
function digest(userId,channel,token){const key=mfaKey();if(!key)throw new AccountError('verification_secret_not_configured',503);return crypto.createHmac('sha256',key).update(`${userId}:${channel}:${token}`).digest('hex');}
function safeEqualHex(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;try{return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}catch{return false;}}

async function makeChallenge(db,{userId,channel,destination,token,now,ttlMinutes}){
 const created=now.toISOString(),id=crypto.randomUUID();
 await db.prepare('UPDATE verification_challenges SET consumed_at=? WHERE user_id=? AND channel=? AND consumed_at IS NULL').run(created,userId,channel);
 await db.prepare('INSERT INTO verification_challenges(id,user_id,channel,destination,token_hash,expires_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id,userId,channel,destination,digest(userId,channel,token),new Date(now.getTime()+ttlMinutes*60000).toISOString(),created);
 return id;
}
function validateIdentity({email,phone,firstName,lastName,password}){
 const normalizedEmail=typeof email==='string'?email.trim().toLowerCase():'';
 if(normalizedEmail.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))throw new AccountError('invalid_email');
 if(typeof phone!=='string'||!/^(?:\+[1-9]\d{7,14})$/.test(phone.trim()))throw new AccountError('invalid_phone_e164');
 for(const [field,value] of [['first_name',firstName],['last_name',lastName]])if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw new AccountError(`invalid_${field}`);
 if(typeof password!=='string'||Buffer.byteLength(password,'utf8')<12||Buffer.byteLength(password,'utf8')>1024)throw new AccountError('invalid_password');
 return {email:normalizedEmail,phone:phone.trim(),firstName:firstName.trim(),lastName:lastName.trim(),password};
}

async function registerClient(db,input,{sendEmail,now=new Date()}={}){
 const data=validateIdentity(input);if(typeof sendEmail!=='function')throw new AccountError('email_provider_not_configured',503);
 const id=crypto.randomUUID(),emailToken=crypto.randomBytes(32).toString('base64url'),passwordHash=await hashPassword(data.password),timestamp=now.toISOString();
 const emailChallengeId=await withTransaction(db,async tx=>{
  if(await tx.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?)').get(data.email))throw new AccountError('account_already_exists',409);
  if(await tx.prepare('SELECT 1 FROM users WHERE phone=?').get(data.phone))throw new AccountError('phone_already_in_use',409);
  await tx.prepare(`INSERT INTO users(id,email,phone,first_name,last_name,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,'CLIENT',?,?)`).run(id,data.email,data.phone,data.firstName,data.lastName,passwordHash,timestamp,timestamp);
  const emailId=await makeChallenge(tx,{userId:id,channel:'EMAIL',destination:data.email,token:emailToken,now,ttlMinutes:30});
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,'CLIENT_REGISTERED','USER',?,?,'SUCCESS',?)`).run(crypto.randomUUID(),id,id,JSON.stringify({email:data.email,phone:data.phone,verified:false}),timestamp);
  return emailId;
 });
 await sendEmail({to:data.email,token:emailToken,firstName:data.firstName,idempotencyKey:`client-verification:${emailChallengeId}`});
 return {userId:id,email:data.email,verificationRequired:{email:true,phone:false}};
}

async function resendClientVerification(db,{email,sendEmail,now=new Date()}){
 const normalized=typeof email==='string'?email.trim().toLowerCase():'';if(!normalized||normalized.length>254)throw new AccountError('invalid_email');
 if(typeof sendEmail!=='function')throw new AccountError('email_provider_not_configured',503);
 const user=await db.prepare("SELECT id,email,first_name,phone,email_verified_at,phone_verified_at FROM users WHERE lower(email)=lower(?) AND role='CLIENT' AND disabled_at IS NULL").get(normalized);if(!user)return {accepted:true};
 let emailChallenge=null,emailToken=null;
 await withTransaction(db,async tx=>{
  if(!user.email_verified_at){emailToken=crypto.randomBytes(32).toString('base64url');emailChallenge=await makeChallenge(tx,{userId:user.id,channel:'EMAIL',destination:user.email,token:emailToken,now,ttlMinutes:30});}
 });
 if(emailToken)await sendEmail({to:user.email,token:emailToken,firstName:user.first_name,idempotencyKey:`client-verification:${emailChallenge}`});
 return {accepted:true};
}

async function verifyEmail(db,{token,now=new Date()}){
 if(typeof token!=='string'||token.length<40||token.length>100)throw new AccountError('invalid_or_expired_token',400);
 const created=now.toISOString(),rows=await db.prepare("SELECT c.id,c.user_id,c.destination,c.token_hash,u.email,u.first_name,u.email_verified_at FROM verification_challenges c JOIN users u ON u.id=c.user_id WHERE c.channel='EMAIL' AND c.consumed_at IS NULL AND c.expires_at>? AND u.role='CLIENT' AND u.disabled_at IS NULL").all(created);
 const challenge=rows.find(row=>row.destination.toLowerCase()===row.email.toLowerCase()&&safeEqualHex(row.token_hash,digest(row.user_id,'EMAIL',token)));
 if(!challenge)throw new AccountError('invalid_or_expired_token',400);
 return withTransaction(db,async tx=>{
  const consumed=await tx.prepare("UPDATE verification_challenges SET consumed_at=?,attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND token_hash=?").run(created,challenge.id,created,digest(challenge.user_id,'EMAIL',token));
  if(consumed.changes!==1)throw new AccountError('invalid_or_expired_token',400);
  const verified=await tx.prepare('UPDATE users SET email_verified_at=?,version=version+1,updated_at=? WHERE id=? AND email_verified_at IS NULL').run(created,created,challenge.user_id);
  // Bienvenue : une seule fois, dans la même transaction que la vérification (jamais sur un simple rafraîchissement).
  if(verified.changes===1)await enqueueEmail(tx,{kind:'welcome',to:challenge.email,payload:{firstName:challenge.first_name},dedupeKey:`welcome:${challenge.user_id}`,now});
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,'CLIENT_EMAIL_VERIFIED','USER',?,'{}','SUCCESS',?)`).run(crypto.randomUUID(),challenge.user_id,challenge.user_id,created);
  return {verified:true};
 });
}

async function verifyPhone(db,{email,code,now=new Date()}){
 const normalized=typeof email==='string'?email.trim().toLowerCase():'';if(!/^\d{6}$/.test(String(code||'')))throw new AccountError('invalid_or_expired_code',400);
 const user=await db.prepare("SELECT id,phone,phone_verified_at FROM users WHERE lower(email)=lower(?) AND role='CLIENT' AND disabled_at IS NULL").get(normalized);
 if(!user)throw new AccountError('invalid_or_expired_code',400);if(user.phone_verified_at)return {verified:true};
 const timestamp=now.toISOString();
 const result=await withTransaction(db,async tx=>{
  const challenge=await tx.prepare("SELECT id,token_hash,attempts FROM verification_challenges WHERE user_id=? AND channel='PHONE' AND destination=? AND consumed_at IS NULL AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(user.id,user.phone,timestamp);
  if(!challenge||challenge.attempts>=5)return {invalid:true};
  const valid=safeEqualHex(challenge.token_hash,digest(user.id,'PHONE',String(code)));
  if(!valid){await tx.prepare('UPDATE verification_challenges SET attempts=attempts+1 WHERE id=? AND attempts<5').run(challenge.id);return {invalid:true};}
  const consumed=await tx.prepare("UPDATE verification_challenges SET consumed_at=?,attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND attempts<5").run(timestamp,challenge.id);
  if(consumed.changes!==1)throw new AccountError('invalid_or_expired_code',400);
  await tx.prepare('UPDATE users SET phone_verified_at=?,version=version+1,updated_at=? WHERE id=? AND phone_verified_at IS NULL').run(timestamp,timestamp,user.id);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,'CLIENT_PHONE_VERIFIED','USER',?,'{}','SUCCESS',?)`).run(crypto.randomUUID(),user.id,user.id,timestamp);
  return {verified:true};
 });
 if(result.invalid)throw new AccountError('invalid_or_expired_code',400);
 return result;
}

async function requestPasswordReset(db,{email,sendEmail,now=new Date()}){
 const normalized=typeof email==='string'?email.trim().toLowerCase():'';if(!normalized||normalized.length>254)throw new AccountError('invalid_email');if(typeof sendEmail!=='function')throw new AccountError('email_provider_not_configured',503);
 const user=await db.prepare("SELECT id,email,first_name FROM users WHERE lower(email)=lower(?) AND role='CLIENT' AND disabled_at IS NULL").get(normalized);if(!user)return {accepted:true};
 const token=crypto.randomBytes(32).toString('base64url'),id=crypto.randomUUID(),timestamp=now.toISOString();
 await withTransaction(db,async tx=>{
  await tx.prepare("UPDATE verification_challenges SET consumed_at=? WHERE user_id=? AND channel='PASSWORD_RESET' AND consumed_at IS NULL").run(timestamp,user.id);
  await tx.prepare("INSERT INTO verification_challenges(id,user_id,channel,destination,token_hash,expires_at,created_at) VALUES(?,?,'PASSWORD_RESET',?,?,?,?)").run(id,user.id,user.email,digest(user.id,'PASSWORD_RESET',token),new Date(now.getTime()+30*60000).toISOString(),timestamp);
 });
 await sendEmail({to:user.email,token,firstName:user.first_name,idempotencyKey:`password-reset:${id}`,kind:'password-reset'});return {accepted:true};
}

async function resetClientPassword(db,{token,newPassword,now=new Date()}){
 if(typeof token!=='string'||token.length<40||token.length>100)throw new AccountError('invalid_or_expired_token',400);if(typeof newPassword!=='string'||Buffer.byteLength(newPassword,'utf8')<12||Buffer.byteLength(newPassword,'utf8')>1024)throw new AccountError('invalid_new_password',400);
 const timestamp=now.toISOString(),rows=await db.prepare("SELECT c.id,c.user_id,c.token_hash FROM verification_challenges c JOIN users u ON u.id=c.user_id WHERE c.channel='PASSWORD_RESET' AND c.consumed_at IS NULL AND c.expires_at>? AND c.attempts<5 AND u.role='CLIENT' AND u.disabled_at IS NULL").all(timestamp),challenge=rows.find(row=>safeEqualHex(row.token_hash,digest(row.user_id,'PASSWORD_RESET',token)));
 if(!challenge)throw new AccountError('invalid_or_expired_token',400);
 const passwordHash=await hashPassword(newPassword);
 return withTransaction(db,async tx=>{
  const consumed=await tx.prepare("UPDATE verification_challenges SET consumed_at=?,attempts=attempts+1 WHERE id=? AND consumed_at IS NULL AND expires_at>? AND attempts<5").run(timestamp,challenge.id,timestamp);
  if(consumed.changes!==1)throw new AccountError('invalid_or_expired_token',400);
  await tx.prepare('UPDATE users SET password_hash=?,version=version+1,updated_at=? WHERE id=?').run(passwordHash,timestamp,challenge.user_id);
  await tx.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(timestamp,challenge.user_id);
  await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,'CLIENT_PASSWORD_RESET','USER',?,'{}','SUCCESS',?)`).run(crypto.randomUUID(),challenge.user_id,challenge.user_id,timestamp);
  return {reset:true};
 });
}

module.exports={AccountError,registerClient,resendClientVerification,verifyEmail,verifyPhone,requestPasswordReset,resetClientPassword};
