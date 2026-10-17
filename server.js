const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDatabase } = require('./lib/database');
const { hashPassword, verifyPassword, verifyAndConsumeTotp, createSession, sessionFromRequest, cookieHeader, logout, mfaKey } = require('./lib/auth');
const { createBooking } = require('./lib/booking');
const { getDayAvailability, getMonthAvailability } = require('./lib/availability');
const { registerClient, resendClientVerification, verifyEmail, requestPasswordReset, resetClientPassword } = require('./lib/accounts');
const { emailConfigured, publicBaseUrl, sendVerificationEmail, providerStatus } = require('./lib/providers');
const { transitionAppointment, modifyAppointment } = require('./lib/appointments');
const { recordOnsitePayment, correctOnsitePayment } = require('./lib/payments');
const { submitReview, decideReview } = require('./lib/reviews');
const { getDashboardSummary } = require('./lib/dashboard');
const { requestCancellation, resolveCancellationRequest } = require('./lib/cancellations');
const { processOutbox } = require('./lib/notifications');
const { dispatchScheduledNotifications } = require('./lib/scheduled-jobs');
const { consumeAttempt } = require('./lib/rate-limit');
const { withTransaction } = require('./lib/database');

function assertProductionConfiguration(){
 if(!mfaKey())throw new Error('Production requires CUTLY_MFA_ENCRYPTION_KEY (base64-encoded 32-byte key).');
 if(!emailConfigured())throw new Error('Production requires RESEND_API_KEY and CUTLY_EMAIL_FROM.');

 try{publicBaseUrl();}catch{throw new Error('Production requires a valid HTTPS CUTLY_PUBLIC_BASE_URL.');}
 if(!(process.env.CUTLY_DATABASE_URL||process.env.DATABASE_URL||process.env.NETLIFY_DB_URL))throw new Error('Production requires CUTLY_DATABASE_URL or DATABASE_URL for PostgreSQL.');
}
if(process.env.NODE_ENV==='production'||process.env.NETLIFY==='true')assertProductionConfiguration();

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = process.env.CUTLY_DB_PATH || path.join(DATA_DIR, 'cutly.sqlite');
const DATABASE_URL=process.env.CUTLY_DATABASE_URL||process.env.DATABASE_URL||process.env.NETLIFY_DB_URL;
if(!DATABASE_URL)fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = createDatabase({url:DATABASE_URL,sqlitePath:DB_PATH});
const shop = {
 id: 'thomas-shop', name: 'Thomas Shop', professional: 'Thomas',
 address: '8 cours de l’Île Seguin, Boulogne-Billancourt, France', phone: '+33 7 78 54 68 92',
 instagram: 'https://www.instagram.com/thomas.921g?srtk=MWpqZmprbnBnbzhzNQ==',
 description: 'Depuis plusieurs années, Thomas exerce dans le domaine de la coiffure professionnelle. Il propose des prestations de coiffure adaptées aux envies de chacun, avec une attention particulière portée aux finitions et à la qualité du résultat.'
};
const bootstrapDb=db.kind==='SQLITE'?db.sqlite:null;
if(bootstrapDb){
bootstrapDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
bootstrapDb.exec(`
CREATE TABLE IF NOT EXISTS establishments (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL,
 instagram TEXT NOT NULL, description TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'Europe/Paris'
);
CREATE TABLE IF NOT EXISTS services (
 id TEXT PRIMARY KEY, establishment_id TEXT NOT NULL REFERENCES establishments(id), name TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents >= 0), duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
 active INTEGER NOT NULL DEFAULT 1, eligible INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS opening_hours (
 establishment_id TEXT NOT NULL REFERENCES establishments(id), weekday INTEGER NOT NULL,
 opens TEXT, closes TEXT, version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(establishment_id, weekday)
);
CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY, establishment_id TEXT NOT NULL REFERENCES establishments(id), service_id TEXT NOT NULL REFERENCES services(id),
 client_name TEXT NOT NULL, client_email TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
 timezone TEXT NOT NULL, service_name_snapshot TEXT NOT NULL, price_cents_snapshot INTEGER NOT NULL,
 duration_minutes_snapshot INTEGER NOT NULL, loyalty_eligible_snapshot INTEGER NOT NULL DEFAULT 1,
 client_user_id TEXT REFERENCES users(id), reward_id TEXT REFERENCES rewards(id),
 status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','COMPLETED','NO_SHOW')),
 payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PAID','NOT_APPLICABLE')),
 created_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE, phone TEXT UNIQUE,
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, password_hash TEXT NOT NULL,
 email_verified_at TEXT, phone_verified_at TEXT, preferred_language TEXT NOT NULL DEFAULT 'fr',
 role TEXT NOT NULL DEFAULT 'CLIENT' CHECK(role IN ('CLIENT','PROFESSIONAL','ESTABLISHMENT_ADMIN','PLATFORM_ADMIN')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, disabled_at TEXT, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
 id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS admin_mfa (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
 last_used_step INTEGER NOT NULL DEFAULT -1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_challenges (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('EMAIL','PHONE','PASSWORD_RESET')),
 destination TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
 consumed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS establishment_members (
 user_id TEXT NOT NULL REFERENCES users(id), establishment_id TEXT NOT NULL REFERENCES establishments(id),
 role TEXT NOT NULL CHECK(role IN ('PROFESSIONAL','ESTABLISHMENT_ADMIN')),
 active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(user_id,establishment_id,role)
);
CREATE TABLE IF NOT EXISTS unavailability (
 id TEXT PRIMARY KEY, establishment_id TEXT NOT NULL REFERENCES establishments(id),
 starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT, created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, CHECK(ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS cancellation_requests (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 requested_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','ACCEPTED','REJECTED')), reason TEXT, created_at TEXT NOT NULL,
 resolved_at TEXT, resolved_by TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS payment_events (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
 status TEXT NOT NULL CHECK(status IN ('PAID','CORRECTION','NOT_APPLICABLE')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>=0), method TEXT, actor_id TEXT REFERENCES users(id),
 reason TEXT, correction_of TEXT REFERENCES payment_events(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS loyalty_ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), appointment_id TEXT REFERENCES appointments(id),
 kind TEXT NOT NULL CHECK(kind IN ('EARN','REDEEM','RESTORE','CORRECTION','REVIEW_NO_SHOW')),
 points INTEGER NOT NULL, cycle_number INTEGER NOT NULL DEFAULT 1, reward_id TEXT REFERENCES rewards(id), actor_id TEXT REFERENCES users(id), reason TEXT,
 reference_id TEXT REFERENCES loyalty_ledger(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rewards (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), cycle_number INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','USED','REVIEW_NO_SHOW','CANCELLED')),
 earned_at TEXT NOT NULL, used_appointment_id TEXT REFERENCES appointments(id), used_at TEXT,
 UNIQUE(user_id,cycle_number)
);
CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id),
 user_id TEXT NOT NULL REFERENCES users(id), rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT, status TEXT NOT NULL DEFAULT 'PENDING_MODERATION'
 CHECK(status IN ('PENDING_MODERATION','PUBLISHED','REPORTED','HIDDEN')),
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), establishment_id TEXT REFERENCES establishments(id),
 action TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL,
 before_json TEXT, after_json TEXT, reason TEXT, result TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notification_outbox (
 id TEXT PRIMARY KEY, appointment_id TEXT REFERENCES appointments(id), channel TEXT NOT NULL,
 kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING'
 CHECK(status IN ('PENDING','SENT','FAILED','RETRYING','OBSOLETE')),
 payload_json TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
 sent_at TEXT, last_error TEXT, created_at TEXT NOT NULL, provider_name TEXT, provider_message_id TEXT, provider_status TEXT,
 UNIQUE(appointment_id,channel,kind)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
 key TEXT PRIMARY KEY, scope TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_time_idx ON appointments(establishment_id, starts_at, ends_at, status);
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);
CREATE INDEX IF NOT EXISTS sessions_user_exp_idx ON sessions(user_id,expires_at);
CREATE INDEX IF NOT EXISTS unavailability_time_idx ON unavailability(establishment_id,starts_at,ends_at);
CREATE INDEX IF NOT EXISTS audit_object_idx ON audit_events(object_type,object_id,created_at);
CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON notification_outbox(status,next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_cancellation_per_appointment ON cancellation_requests(appointment_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS one_earned_point_per_appointment ON loyalty_ledger(appointment_id) WHERE kind='EARN' AND appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS one_paid_event_per_appointment ON payment_events(appointment_id) WHERE status='PAID';
CREATE TRIGGER IF NOT EXISTS prevent_active_appointment_overlap
BEFORE INSERT ON appointments
WHEN NEW.status IN ('PENDING','CONFIRMED')
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM appointments a WHERE a.establishment_id=NEW.establishment_id
   AND a.status IN ('PENDING','CONFIRMED') AND a.starts_at<NEW.ends_at AND a.ends_at>NEW.starts_at
 ) THEN RAISE(ABORT,'appointment_overlap') END;
END;
CREATE TRIGGER IF NOT EXISTS prevent_active_appointment_overlap_update
BEFORE UPDATE OF starts_at,ends_at,status,establishment_id ON appointments
WHEN NEW.status IN ('PENDING','CONFIRMED')
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM appointments a WHERE a.establishment_id=NEW.establishment_id AND a.id<>NEW.id
   AND a.status IN ('PENDING','CONFIRMED') AND a.starts_at<NEW.ends_at AND a.ends_at>NEW.starts_at
 ) THEN RAISE(ABORT,'appointment_overlap') END;
END;
`);

bootstrapDb.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);`);
function hasColumn(table,column){return bootstrapDb.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);}
const migrations=[
 {version:1,name:'initial-domain-schema',up:()=>{}},
 {version:2,name:'booking-and-loyalty-snapshots',up:()=>{
  if(!hasColumn('appointments','loyalty_eligible_snapshot'))bootstrapDb.exec('ALTER TABLE appointments ADD COLUMN loyalty_eligible_snapshot INTEGER NOT NULL DEFAULT 1');
  if(!hasColumn('appointments','client_user_id'))bootstrapDb.exec('ALTER TABLE appointments ADD COLUMN client_user_id TEXT REFERENCES users(id)');
  if(!hasColumn('loyalty_ledger','cycle_number'))bootstrapDb.exec('ALTER TABLE loyalty_ledger ADD COLUMN cycle_number INTEGER NOT NULL DEFAULT 1');
 }},
 {version:3,name:'appointment-reward-link',up:()=>{
  if(!hasColumn('appointments','reward_id'))bootstrapDb.exec('ALTER TABLE appointments ADD COLUMN reward_id TEXT REFERENCES rewards(id)');
 }},
 {version:4,name:'version-opening-hours',up:()=>{
  if(!hasColumn('opening_hours','version'))bootstrapDb.exec('ALTER TABLE opening_hours ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
 }},
 {version:5,name:'version-users',up:()=>{
  if(!hasColumn('users','version'))bootstrapDb.exec('ALTER TABLE users ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
 }},
 {version:6,name:'notification-provider-receipts',up:()=>{
  if(!hasColumn('notification_outbox','provider_name'))bootstrapDb.exec('ALTER TABLE notification_outbox ADD COLUMN provider_name TEXT');
  if(!hasColumn('notification_outbox','provider_message_id'))bootstrapDb.exec('ALTER TABLE notification_outbox ADD COLUMN provider_message_id TEXT');
  if(!hasColumn('notification_outbox','provider_status'))bootstrapDb.exec('ALTER TABLE notification_outbox ADD COLUMN provider_status TEXT');
 }},
 {version:7,name:'shared-rate-limits',up:()=>bootstrapDb.exec('CREATE TABLE IF NOT EXISTS rate_limits(key_hash TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits(expires_at);')}
];
for(const migration of migrations){
 if(bootstrapDb.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(migration.version))continue;
 bootstrapDb.exec('BEGIN IMMEDIATE');
 try{migration.up();bootstrapDb.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(migration.version,migration.name,new Date().toISOString());bootstrapDb.exec('COMMIT');}
 catch(error){bootstrapDb.exec('ROLLBACK');throw error;}
}


const upsertShop = bootstrapDb.prepare(`INSERT OR IGNORE INTO establishments(id,name,address,phone,instagram,description,timezone) VALUES(?,?,?,?,?,?, 'Europe/Paris')`);
upsertShop.run(shop.id, shop.name, shop.address, shop.phone, shop.instagram, shop.description);
const seedService = bootstrapDb.prepare('INSERT OR IGNORE INTO services(id,establishment_id,name,price_cents,duration_minutes,eligible) VALUES(?,?,?,?,?,?)');
[
 ['degrade-classique','Dégradé classique',500,30,1],['burst-fade','Burst Fade',700,30,1],
 ['taper','Taper',500,30,1],['coupe-classique','Coupe classique',500,30,1],['contours','Contours',500,15,0]
].forEach(([id,name,price,duration,eligible]) => seedService.run(id,shop.id,name,price,duration,eligible));
// Seed official launch hours only when a row does not exist. Reapplying defaults
// at every restart would silently overwrite Thomas's saved schedule.
const seedHours = bootstrapDb.prepare('INSERT OR IGNORE INTO opening_hours(establishment_id,weekday,opens,closes) VALUES(?,?,?,?)');
for (let day=0; day<7; day++) seedHours.run(shop.id,day,(day===0||day===6)?'09:00':null,(day===0||day===6)?'19:00':null);

}

async function initializePostgres(){
 if(db.kind!=='POSTGRES')return;
 const schema=fs.readFileSync(path.join(ROOT,'db/postgres/schema.sql'),'utf8');
 await db.transaction(async tx=>{
  await tx.lock('cutly:initialize-postgres-schema');
  await tx.exec(schema);
  await tx.prepare(`INSERT INTO establishments(id,name,address,phone,instagram,description,timezone) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).run(shop.id,shop.name,shop.address,shop.phone,shop.instagram,shop.description,'Europe/Paris');
  const services=[['degrade-classique','Dégradé classique',500,30,1],['burst-fade','Burst Fade',700,30,1],['taper','Taper',500,30,1],['coupe-classique','Coupe classique',500,30,1],['contours','Contours',500,15,0]];
  for(const [id,name,price,duration,eligible] of services)await tx.prepare('INSERT INTO services(id,establishment_id,name,price_cents,duration_minutes,eligible) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').run(id,shop.id,name,price,duration,eligible);
  for(let day=0;day<7;day++)await tx.prepare('INSERT INTO opening_hours(establishment_id,weekday,opens,closes) VALUES(?,?,?,?) ON CONFLICT(establishment_id,weekday) DO NOTHING').run(shop.id,day,(day===0||day===6)?'09:00':null,(day===0||day===6)?'19:00':null);
 });
}

async function publicServices(){return (await db.prepare("SELECT id,name,price_cents AS priceCents,duration_minutes AS durationMinutes FROM services WHERE establishment_id=? AND active=1 ORDER BY CASE id WHEN 'degrade-classique' THEN 1 WHEN 'burst-fade' THEN 2 WHEN 'taper' THEN 3 WHEN 'coupe-classique' THEN 4 WHEN 'contours' THEN 5 ELSE 99 END,lower(name)").all(shop.id));}
async function findService(id,establishmentId){return (await db.prepare('SELECT * FROM services WHERE id=? AND establishment_id=? AND active=1').get(id,establishmentId));}
const MIME = { '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml' };
const SECURITY_HEADERS={'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()','content-security-policy':"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"};
function json(res,status,payload,extra={}) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...SECURITY_HEADERS,...extra});res.end(JSON.stringify(payload)); }
function readBody(req){return new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>16_384){reject(new Error('body_too_large'));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{reject(new Error('invalid_json'));}});req.on('error',reject);});}
const loginAttempts=new Map();
const dummyPasswordHash=hashPassword('CUTLY-unknown-account-password');
function rateLimitKey(req,email){return `${req.socket.remoteAddress||'unknown'}:${String(email||'').trim().toLowerCase().slice(0,254)}`;}
function allowPublicAttempt(key,limit=5,windowMs=15*60*1000){return consumeAttempt(db,key,limit,windowMs);}
function checkSameOrigin(req){const origin=req.headers.origin;if(!origin)return process.env.NODE_ENV!=='production';try{return new URL(origin).host===req.headers.host;}catch{return false;}}
function sessionFor(req){return sessionFromRequest(db,req);}
function adminFailure(res,error){return json(res,error.status||500,{error:error.code||'request_failed'});}
const CLIENT_APPOINTMENT_FIELDS=`id,service_name_snapshot AS serviceName,price_cents_snapshot AS priceCents,duration_minutes_snapshot AS durationMinutes,starts_at AS startsAt,ends_at AS endsAt,timezone,status,payment_status AS paymentStatus,reward_id AS rewardId,version,created_at AS createdAt,(SELECT status FROM reviews WHERE appointment_id=appointments.id) AS reviewStatus,(SELECT status FROM cancellation_requests WHERE appointment_id=appointments.id ORDER BY created_at DESC,id DESC LIMIT 1) AS cancellationStatus`;
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/internal/notifications'){
   if(req.method!=='POST')return json(res,405,{error:'method_not_allowed'},{allow:'POST'});
   const result=await dispatchScheduledNotifications(db,req.headers.authorization);return json(res,result.status,result.body);
  }
  if(req.method==='GET'&&url.pathname==='/healthz'){
    try{await db.prepare('SELECT 1 AS ok').get();return json(res,200,{status:'ok'});}catch{return json(res,503,{status:'unavailable'});}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/register'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const body=await readBody(req),key=rateLimitKey(req,'register');if(!await allowPublicAttempt(key,3,60*60*1000))return json(res,429,{error:'too_many_attempts'});
    if(!await db.prepare("SELECT 1 FROM users u JOIN establishment_members m ON m.user_id=u.id JOIN admin_mfa f ON f.user_id=u.id WHERE u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id='thomas-shop' AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1 AND f.enabled=1 LIMIT 1").get())return json(res,503,{error:'administrator_not_initialized'});
   if(!emailConfigured())return json(res,503,{error:'email_provider_not_configured'});try{publicBaseUrl();}catch(error){return adminFailure(res,error);}
    try{const account=await registerClient(db,body,{sendEmail:message=>sendVerificationEmail(message)});const session=await createSession(db,account.userId,req.headers['user-agent']);return json(res,201,{email:account.email,verificationRequired:account.verificationRequired},{'set-cookie':cookieHeader(session.token)});}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/resend-verification'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const body=await readBody(req),key=rateLimitKey(req,body.email);if(!await allowPublicAttempt(key,3,60*60*1000))return json(res,429,{error:'too_many_attempts'});if(!emailConfigured())return json(res,503,{error:'email_provider_not_configured'});try{publicBaseUrl();}catch(error){return adminFailure(res,error);}
   try{return json(res,202,await resendClientVerification(db,{email:body.email,sendEmail:message=>sendVerificationEmail(message)}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/verify-email'){
    if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const body=await readBody(req);try{return json(res,200,await verifyEmail(db,{token:body.token}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/verify-phone')return json(res,410,{error:'phone_verification_not_required'});
  if(req.method==='POST'&&url.pathname==='/api/auth/client/password-reset'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const body=await readBody(req),key=rateLimitKey(req,body.email);if(!await allowPublicAttempt(key,3,60*60*1000))return json(res,429,{error:'too_many_attempts'});if(!emailConfigured())return json(res,503,{error:'email_provider_not_configured'});try{publicBaseUrl();}catch(error){return adminFailure(res,error);}
   try{await requestPasswordReset(db,{email:body.email,sendEmail:message=>sendVerificationEmail(message),sendSms:message=>sendPhoneCode(message)});return json(res,202,{accepted:true});}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/password-reset/confirm'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const body=await readBody(req);try{return json(res,200,await resetClientPassword(db,{token:body.token,newPassword:body.newPassword}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/client/login'){
   const body=await readBody(req);if(!await consumeAttempt(db,`client-login:${String(body.email||'').trim().toLowerCase()}`,10,15*60*1000))return json(res,429,{error:'too_many_attempts'});const key=`client:${rateLimitKey(req,body.email)}`,windowMs=15*60*1000,now=Date.now(),bucket=loginAttempts.get(key);
   if(bucket&&bucket.until>now&&bucket.count>=5)return json(res,429,{error:'too_many_attempts'},{'retry-after':String(Math.ceil((bucket.until-now)/1000))});
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';const user=await db.prepare("SELECT id,email,password_hash,role,disabled_at FROM users WHERE lower(email)=lower(?) AND role='CLIENT'").get(email);
   const passwordOk=await verifyPassword(String(body.password||''),user?.password_hash||await dummyPasswordHash);if(!user||user.disabled_at||!passwordOk){const current=loginAttempts.get(key);loginAttempts.set(key,{count:(current&&current.until>now?current.count:0)+1,until:current&&current.until>now?current.until:now+windowMs});return json(res,401,{error:'invalid_credentials'});}
    loginAttempts.delete(key);const session=await createSession(db,user.id,req.headers['user-agent']);return json(res,200,{user:{email:user.email,role:user.role},expiresAt:session.expiresAt},{'set-cookie':cookieHeader(session.token)});
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/admin/login'){
   const body=await readBody(req);if(!await consumeAttempt(db,`admin-login:${String(body.email||'').trim().toLowerCase()}`,10,15*60*1000))return json(res,429,{error:'too_many_attempts'});const key=rateLimitKey(req,body.email),windowMs=15*60*1000,now=Date.now();
   const bucket=loginAttempts.get(key);if(bucket&&bucket.until>now&&bucket.count>=5)return json(res,429,{error:'too_many_attempts'},{'retry-after':String(Math.ceil((bucket.until-now)/1000))});
   const normalized=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    const user=await db.prepare("SELECT id,email,password_hash,role,disabled_at FROM users WHERE lower(email)=lower(?)").get(normalized);
    const mfa=user&&user.role==='ESTABLISHMENT_ADMIN'&&!user.disabled_at?await db.prepare('SELECT enabled FROM admin_mfa WHERE user_id=?').get(user.id):null;
    const member=user&&await db.prepare("SELECT 1 FROM establishment_members WHERE user_id=? AND establishment_id='thomas-shop' AND role='ESTABLISHMENT_ADMIN' AND active=1").get(user.id);
    const valid=user&&user.role==='ESTABLISHMENT_ADMIN'&&!user.disabled_at&&mfa?.enabled===1&&member&&await verifyPassword(String(body.password||''),user.password_hash)&&await verifyAndConsumeTotp(db,user.id,body.otp);
   if(!valid){const current=loginAttempts.get(key);loginAttempts.set(key,{count:(current&&current.until>now?current.count:0)+1,until:current&&current.until>now?current.until:now+windowMs});return json(res,401,{error:'invalid_credentials'});}
    loginAttempts.delete(key);const session=await createSession(db,user.id,req.headers['user-agent']);return json(res,200,{user:{email:user.email,role:user.role},expiresAt:session.expiresAt},{'set-cookie':cookieHeader(session.token)});
  }
  if(req.method==='GET'&&url.pathname==='/api/auth/session'){
    const session=await sessionFor(req);if(!session)return json(res,401,{error:'authentication_required'});
   return json(res,200,{user:{email:session.email,role:session.role},expiresAt:session.expires_at});
  }
  const clientCancellationRoute=url.pathname.match(/^\/api\/client\/appointments\/([^/]+)\/cancellation$/);
  if(req.method==='POST'&&clientCancellationRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);if(body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.length>500))return json(res,400,{error:'invalid_reason'});
   try{return json(res,200,await requestCancellation(db,{appointmentId:clientCancellationRoute[1],actorId:session.user_id,reason:body.reason}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/client/profile'){
   const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const profile=(await db.prepare('SELECT id,email,phone,first_name AS firstName,last_name AS lastName,email_verified_at AS emailVerifiedAt,phone_verified_at AS phoneVerifiedAt,preferred_language AS language,version FROM users WHERE id=? AND role=\'CLIENT\' AND disabled_at IS NULL').get(session.user_id));if(!profile)return json(res,404,{error:'account_not_found'});return json(res,200,profile);
  }
  if(req.method==='GET'&&url.pathname==='/api/client/export'){
   const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const user=(await db.prepare("SELECT id,email,phone,first_name AS firstName,last_name AS lastName,email_verified_at AS emailVerifiedAt,phone_verified_at AS phoneVerifiedAt,preferred_language AS language,created_at AS createdAt FROM users WHERE id=? AND role='CLIENT' AND disabled_at IS NULL").get(session.user_id));if(!user)return json(res,404,{error:'account_not_found'});
   const appointments=(await db.prepare('SELECT id,establishment_id AS establishmentId,service_name_snapshot AS serviceName,price_cents_snapshot AS priceCents,duration_minutes_snapshot AS durationMinutes,starts_at AS startsAt,ends_at AS endsAt,timezone,status,payment_status AS paymentStatus,reward_id AS rewardId,created_at AS createdAt FROM appointments WHERE client_user_id=? ORDER BY starts_at DESC').all(session.user_id));
   const cancellations=(await db.prepare('SELECT c.id,c.appointment_id AS appointmentId,c.status,c.reason,c.created_at AS createdAt,c.resolved_at AS resolvedAt FROM cancellation_requests c JOIN appointments a ON a.id=c.appointment_id WHERE a.client_user_id=? ORDER BY c.created_at DESC').all(session.user_id));
   const payments=(await db.prepare("SELECT p.id,p.appointment_id AS appointmentId,p.status,p.amount_cents AS amountCents,p.method,p.reason,p.created_at AS createdAt FROM payment_events p JOIN appointments a ON a.id=p.appointment_id WHERE a.client_user_id=? AND p.status IN ('PAID','NOT_APPLICABLE','CORRECTION') ORDER BY p.created_at DESC").all(session.user_id));
   const rewards=(await db.prepare('SELECT id,cycle_number AS cycleNumber,status,earned_at AS earnedAt,used_appointment_id AS usedAppointmentId,used_at AS usedAt FROM rewards WHERE user_id=? ORDER BY cycle_number').all(session.user_id));
   const loyalty=(await db.prepare('SELECT id,appointment_id AS appointmentId,kind,points,cycle_number AS cycleNumber,reward_id AS rewardId,reason,created_at AS createdAt FROM loyalty_ledger WHERE user_id=? ORDER BY created_at').all(session.user_id));
   const reviews=(await db.prepare('SELECT r.id,r.appointment_id AS appointmentId,r.rating,r.comment,r.status,r.created_at AS createdAt FROM reviews r WHERE r.user_id=? ORDER BY r.created_at').all(session.user_id));
   const sessions=(await db.prepare('SELECT created_at AS createdAt,expires_at AS expiresAt,revoked_at AS revokedAt,user_agent AS userAgent FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(session.user_id));
   const verifications=(await db.prepare('SELECT channel,created_at AS createdAt,expires_at AS expiresAt,consumed_at AS consumedAt FROM verification_challenges WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(session.user_id));
   const audit=(await db.prepare('SELECT action,object_type AS objectType,object_id AS objectId,result,created_at AS createdAt FROM audit_events WHERE actor_id=? ORDER BY created_at DESC LIMIT 200').all(session.user_id));
   (await db.prepare("INSERT INTO audit_events(id,actor_id,action,object_type,object_id,result,created_at) VALUES(?,?,'CLIENT_DATA_EXPORTED','USER',?,'SUCCESS',?)").run(crypto.randomUUID(),session.user_id,session.user_id,new Date().toISOString()));
   return json(res,200,{exportedAt:new Date().toISOString(),user,appointments,cancellations,payments,rewards,loyalty,reviews,sessions,verifications,audit},{'content-disposition':'attachment; filename="cutly-personal-data.json"'});
  }
  if(req.method==='PATCH'&&url.pathname==='/api/client/profile'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);if(!Number.isSafeInteger(body.version)||body.version<1)return json(res,400,{error:'version_required'});if(typeof body.firstName!=='string'||!body.firstName.trim()||body.firstName.trim().length>80||typeof body.lastName!=='string'||!body.lastName.trim()||body.lastName.trim().length>80||!['fr','en'].includes(body.language))return json(res,400,{error:'invalid_profile'});
    const phone=typeof body.phone==='string'?body.phone.trim():'';if(!/^\+[1-9]\d{7,14}$/.test(phone))return json(res,400,{error:'invalid_phone_e164'});
    const updatedAt=new Date().toISOString();let outcome;try{outcome=await withTransaction(db,async tx=>{const current=await tx.prepare("SELECT phone FROM users WHERE id=? AND role='CLIENT' AND disabled_at IS NULL AND version=?").get(session.user_id,body.version);if(!current)return 'version_conflict';if(await tx.prepare('SELECT 1 FROM users WHERE phone=? AND id<>?').get(phone,session.user_id))return 'phone_already_in_use';const result=await tx.prepare('UPDATE users SET phone=?,first_name=?,last_name=?,preferred_language=?,version=version+1,updated_at=? WHERE id=? AND role=\'CLIENT\' AND version=? AND disabled_at IS NULL').run(phone,body.firstName.trim(),body.lastName.trim(),body.language,updatedAt,session.user_id,body.version);if(result.changes!==1)return 'version_conflict';await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,before_json,after_json,result,created_at) VALUES(?,?,'CLIENT_PROFILE_UPDATED','USER',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,session.user_id,JSON.stringify({phone:current.phone}),JSON.stringify({phone,firstName:body.firstName.trim(),lastName:body.lastName.trim(),language:body.language}),updatedAt);return 'ok';});}catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE'||error.code==='23505')return json(res,409,{error:'phone_already_in_use'});throw error;}if(outcome!=='ok')return json(res,409,{error:outcome});return json(res,200,{ok:true,version:body.version+1,phone});
  }
  if(req.method==='POST'&&url.pathname==='/api/client/password'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);if(typeof body.newPassword!=='string'||Buffer.byteLength(body.newPassword,'utf8')<12||Buffer.byteLength(body.newPassword,'utf8')>1024)return json(res,400,{error:'invalid_new_password'});
    const user=await db.prepare("SELECT password_hash FROM users WHERE id=? AND role='CLIENT' AND disabled_at IS NULL").get(session.user_id);if(!user||!await verifyPassword(String(body.currentPassword||''),user.password_hash))return json(res,401,{error:'invalid_credentials'});
    const timestamp=new Date().toISOString(),passwordHash=await hashPassword(body.newPassword);const changed=await withTransaction(db,async tx=>{const updated=await tx.prepare("UPDATE users SET password_hash=?,version=version+1,updated_at=? WHERE id=? AND role='CLIENT' AND password_hash=? AND disabled_at IS NULL").run(passwordHash,timestamp,session.user_id,user.password_hash);if(updated.changes!==1)return false;await tx.prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(timestamp,session.user_id);await tx.prepare(`INSERT INTO audit_events(id,actor_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,'CLIENT_PASSWORD_CHANGED','USER',?,'{}','SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,session.user_id,timestamp);return true;});if(!changed)return json(res,409,{error:'credentials_changed'});return json(res,200,{ok:true,message:'password_changed'},{'set-cookie':cookieHeader('',0)});
  }
  if(req.method==='GET'&&url.pathname==='/api/client/appointments'){
   const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
   const rows=(await db.prepare(`SELECT ${CLIENT_APPOINTMENT_FIELDS} FROM appointments WHERE client_user_id=? ORDER BY starts_at DESC LIMIT ? OFFSET ?`).all(session.user_id,limit,offset));return json(res,200,{appointments:rows,limit,offset});
  }
  const clientAppointmentRoute=url.pathname.match(/^\/api\/client\/appointments\/([^/]+)$/);
  if(req.method==='GET'&&clientAppointmentRoute){
   const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const appointment=await db.prepare(`SELECT ${CLIENT_APPOINTMENT_FIELDS} FROM appointments WHERE id=? AND client_user_id=?`).get(clientAppointmentRoute[1],session.user_id);
   return appointment?json(res,200,{appointment}):json(res,404,{error:'appointment_not_found'});
  }
  if(req.method==='GET'&&url.pathname==='/api/client/loyalty'){
   const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const rewards=(await db.prepare('SELECT id,cycle_number AS cycleNumber,status,earned_at AS earnedAt,used_appointment_id AS usedAppointmentId,used_at AS usedAt FROM rewards WHERE user_id=? ORDER BY cycle_number DESC').all(session.user_id));const ledger=(await db.prepare('SELECT id,appointment_id AS appointmentId,kind,points,cycle_number AS cycleNumber,reward_id AS rewardId,reason,created_at AS createdAt FROM loyalty_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(session.user_id));return json(res,200,{rewards,ledger});
  }
  if(req.method==='POST'&&url.pathname==='/api/client/reviews'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);try{return json(res,201,{review:await submitReview(db,{appointmentId:body.appointmentId,userId:session.user_id,rating:body.rating,comment:body.comment})});}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});await logout(db,await sessionFor(req));return json(res,200,{ok:true},{'set-cookie':cookieHeader('',0)});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/dashboard'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   try{return json(res,200,await getDashboardSummary(db,{actorId:session.user_id}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/reviews'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const reviews=(await db.prepare("SELECT r.id,r.appointment_id AS appointmentId,r.rating,r.comment,r.status,r.created_at AS createdAt,u.first_name AS firstName,u.last_name AS lastName FROM reviews r JOIN appointments a ON a.id=r.appointment_id JOIN users u ON u.id=r.user_id WHERE a.establishment_id='thomas-shop' ORDER BY CASE r.status WHEN 'PENDING_MODERATION' THEN 0 ELSE 1 END,r.created_at DESC LIMIT 100").all());return json(res,200,{reviews});
  }
  const reviewDecisionRoute=url.pathname.match(/^\/api\/admin\/reviews\/([^/]+)$/);
  if(req.method==='PATCH'&&reviewDecisionRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});const body=await readBody(req);
   try{return json(res,200,await decideReview(db,{reviewId:reviewDecisionRoute[1],actorId:session.user_id,decision:body.decision,reason:body.reason}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/appointments'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0)),status=url.searchParams.get('status');
   const allowed=['PENDING','CONFIRMED','REJECTED','CANCELLED','COMPLETED','NO_SHOW'];if(status&&!allowed.includes(status))return json(res,400,{error:'invalid_status'});
   const rows=(await db.prepare(`SELECT id,service_id AS serviceId,client_name AS clientName,client_email AS clientEmail,service_name_snapshot AS serviceName,price_cents_snapshot AS priceCents,duration_minutes_snapshot AS durationMinutes,starts_at AS startsAt,ends_at AS endsAt,status,payment_status AS paymentStatus,version,created_at AS createdAt FROM appointments WHERE establishment_id='thomas-shop' ${status?'AND status=?':''} ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END,starts_at,created_at LIMIT ? OFFSET ?`).all(...(status?[status,limit,offset]:[limit,offset])));
   return json(res,200,{appointments:rows,limit,offset});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/clients'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});const search=(url.searchParams.get('q')||'').trim().slice(0,100),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
   const clients=(await db.prepare(`SELECT u.id,u.first_name AS firstName,u.last_name AS lastName,u.email,u.phone,u.email_verified_at AS emailVerifiedAt,u.phone_verified_at AS phoneVerifiedAt,COUNT(a.id) AS appointmentCount,MAX(a.starts_at) AS lastAppointmentAt,COALESCE((SELECT SUM(l.points) FROM loyalty_ledger l WHERE l.user_id=u.id AND l.cycle_number=(SELECT COALESCE(MAX(r.cycle_number),1) FROM rewards r WHERE r.user_id=u.id)),0) AS currentCyclePoints FROM users u JOIN appointments a ON a.client_user_id=u.id AND a.establishment_id='thomas-shop' WHERE u.role='CLIENT' AND u.disabled_at IS NULL AND (?='' OR u.email LIKE ? OR u.first_name LIKE ? OR u.last_name LIKE ? OR u.phone LIKE ?) GROUP BY u.id ORDER BY lastAppointmentAt DESC LIMIT ? OFFSET ?`).all(search,`%${search}%`,`%${search}%`,`%${search}%`,`%${search}%`,limit,offset));return json(res,200,{clients,limit,offset});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/audit'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.min(10000,Math.max(0,Number(url.searchParams.get('offset'))||0));
   const events=(await db.prepare(`SELECT e.id,e.action,e.object_type AS objectType,e.object_id AS objectId,e.before_json AS before,e.after_json AS after,e.reason,e.result,e.created_at AS createdAt,u.email AS actorEmail FROM audit_events e LEFT JOIN users u ON u.id=e.actor_id WHERE e.establishment_id='thomas-shop' OR (e.establishment_id IS NULL AND e.actor_id=?) ORDER BY e.created_at DESC LIMIT ? OFFSET ?`).all(session.user_id,limit,offset));
   return json(res,200,{events,limit,offset});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/cancellations'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const requests=(await db.prepare(`SELECT c.id,c.appointment_id AS appointmentId,c.reason,c.created_at AS createdAt,c.status,c.requested_by AS clientId,a.client_name AS clientName,a.client_email AS clientEmail,a.service_name_snapshot AS serviceName,a.starts_at AS startsAt,a.status AS appointmentStatus,a.version AS appointmentVersion FROM cancellation_requests c JOIN appointments a ON a.id=c.appointment_id WHERE a.establishment_id='thomas-shop' AND c.status='PENDING' ORDER BY c.created_at`).all());return json(res,200,{requests});
  }
  const cancellationResolutionRoute=url.pathname.match(/^\/api\/admin\/cancellations\/([^/]+)$/);
  if(req.method==='PATCH'&&cancellationResolutionRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);try{return json(res,200,await resolveCancellationRequest(db,{requestId:cancellationResolutionRoute[1],actorId:session.user_id,decision:body.decision,expectedVersion:body.version,reason:body.reason}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/services'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   return json(res,200,{services:(await db.prepare("SELECT id,name,price_cents AS priceCents,duration_minutes AS durationMinutes,active,eligible,version FROM services WHERE establishment_id='thomas-shop' ORDER BY CASE id WHEN 'degrade-classique' THEN 1 WHEN 'burst-fade' THEN 2 WHEN 'taper' THEN 3 WHEN 'coupe-classique' THEN 4 WHEN 'contours' THEN 5 ELSE 99 END,lower(name)").all())});
  }
  if(req.method==='POST'&&url.pathname==='/api/admin/services'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||!Number.isSafeInteger(body.priceCents)||body.priceCents<=0||!Number.isSafeInteger(body.durationMinutes)||body.durationMinutes<15||body.durationMinutes%15!==0||typeof body.eligible!=='boolean')return json(res,400,{error:'invalid_service'});
    const result=await withTransaction(db,async tx=>{await tx.lock?.('appointment-space:thomas-shop');if(await tx.prepare("SELECT 1 FROM services WHERE establishment_id='thomas-shop' AND lower(name)=lower(?)").get(body.name.trim()))return {status:409,error:'service_name_exists'};const id=`service-${crypto.randomUUID()}`,now=new Date().toISOString();await tx.prepare('INSERT INTO services(id,establishment_id,name,price_cents,duration_minutes,active,eligible,version) VALUES(?,?,?,?,?,1,?,1)').run(id,'thomas-shop',body.name.trim(),body.priceCents,body.durationMinutes,Number(body.eligible));const after={id,name:body.name.trim(),priceCents:body.priceCents,durationMinutes:body.durationMinutes,active:true,eligible:body.eligible,version:1};await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,?,'SERVICE_CREATED','SERVICE',?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,'thomas-shop',id,JSON.stringify(after),now);return {status:201,service:after};});return json(res,result.status,result.status===201?{service:result.service}:{error:result.error});
  }
  if(req.method==='GET'&&url.pathname==='/api/admin/hours'){
   const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   return json(res,200,{timezone:'Europe/Paris',hours:(await db.prepare("SELECT weekday,opens,closes,version FROM opening_hours WHERE establishment_id='thomas-shop' ORDER BY weekday").all())});
  }
  const hoursRoute=url.pathname.match(/^\/api\/admin\/hours\/([0-6])$/);
  if(req.method==='PATCH'&&hoursRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req),weekday=Number(hoursRoute[1]);
   const validTime=value=>value===null||(typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)&&Number(value.slice(0,2))*60+Number(value.slice(3))<1440&&Number(value.slice(3))%15===0);
   if(!Number.isSafeInteger(body.version)||body.version<1)return json(res,400,{error:'version_required'});
   if(!validTime(body.opens)||!validTime(body.closes)||(body.opens===null)!==(body.closes===null)||(body.opens!==null&&body.opens>=body.closes))return json(res,400,{error:'invalid_hours'});
    const result=await withTransaction(db,async tx=>{await tx.lock?.('appointment-space:thomas-shop');const current=await tx.prepare("SELECT opens,closes,version FROM opening_hours WHERE establishment_id='thomas-shop' AND weekday=?").get(weekday);if(!current)return {status:404,error:'hours_not_found'};if(current.version!==body.version)return {status:409,error:'version_conflict'};const format=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}),weekdayNames=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],nowIso=new Date().toISOString();const candidates=await tx.prepare("SELECT id,starts_at AS startsAt,ends_at AS endsAt,status FROM appointments WHERE establishment_id='thomas-shop' AND status IN ('PENDING','CONFIRMED') AND starts_at>? ORDER BY starts_at").all(nowIso);const conflicts=[];for(const item of candidates){const startDate=new Date(item.startsAt),endDate=new Date(item.endsAt),startParts=Object.fromEntries(format.formatToParts(startDate).map(part=>[part.type,part.value])),endParts=Object.fromEntries(format.formatToParts(endDate).map(part=>[part.type,part.value]));if(weekdayNames.indexOf(new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',weekday:'short'}).format(startDate))!==weekday||`${startParts.year}-${startParts.month}-${startParts.day}`!==`${endParts.year}-${endParts.month}-${endParts.day}`)continue;const startMinute=Number(startParts.hour)*60+Number(startParts.minute),endMinute=Number(endParts.hour)*60+Number(endParts.minute),openMinute=body.opens===null?-1:Number(body.opens.slice(0,2))*60+Number(body.opens.slice(3)),closeMinute=body.closes===null?-1:Number(body.closes.slice(0,2))*60+Number(body.closes.slice(3));if(openMinute<0||startMinute<openMinute||endMinute>closeMinute)conflicts.push(item);}if(conflicts.length)return {status:409,error:'appointments_conflict',appointments:conflicts};const version=current.version+1;const updated=await tx.prepare('UPDATE opening_hours SET opens=?,closes=?,version=? WHERE establishment_id=? AND weekday=? AND version=?').run(body.opens,body.closes,version,'thomas-shop',weekday,current.version);if(updated.changes!==1)return {status:409,error:'version_conflict'};await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,result,created_at) VALUES(?,?,?,'OPENING_HOURS_UPDATED','OPENING_HOURS',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,'thomas-shop',String(weekday),JSON.stringify(current),JSON.stringify({opens:body.opens,closes:body.closes,version}),new Date().toISOString());return {status:200,weekday,opens:body.opens,closes:body.closes,version};});return result.status===200?json(res,200,{weekday,opens:body.opens,closes:body.closes,version:result.version}):json(res,result.status,result.error==='appointments_conflict'?{error:result.error,appointments:result.appointments}:{error:result.error});
  }
  const serviceRoute=url.pathname.match(/^\/api\/admin\/services\/([a-z0-9-]+)$/i);
  if(req.method==='PATCH'&&serviceRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);if(!Number.isSafeInteger(body.version)||body.version<1)return json(res,400,{error:'version_required'});
   if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>100||!Number.isSafeInteger(body.priceCents)||body.priceCents<=0||!Number.isSafeInteger(body.durationMinutes)||body.durationMinutes<15||body.durationMinutes%15!==0||typeof body.active!=='boolean'||typeof body.eligible!=='boolean')return json(res,400,{error:'invalid_service'});
    const result=await withTransaction(db,async tx=>{await tx.lock?.('appointment-space:thomas-shop');const before=await tx.prepare("SELECT * FROM services WHERE id=? AND establishment_id='thomas-shop'").get(serviceRoute[1]);if(!before)return {status:404,error:'service_not_found'};if(before.version!==body.version)return {status:409,error:'version_conflict'};const after={name:body.name.trim(),price_cents:body.priceCents,duration_minutes:body.durationMinutes,active:Number(body.active),eligible:Number(body.eligible),version:before.version+1};const changed=await tx.prepare('UPDATE services SET name=?,price_cents=?,duration_minutes=?,active=?,eligible=?,version=? WHERE id=? AND version=?').run(after.name,after.price_cents,after.duration_minutes,after.active,after.eligible,after.version,before.id,before.version);if(changed.changes!==1)return {status:409,error:'version_conflict'};await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,after_json,result,created_at) VALUES(?,?,?,'SERVICE_UPDATED','SERVICE',?,?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,'thomas-shop',before.id,JSON.stringify(before),JSON.stringify(after),new Date().toISOString());return {status:200,service:{id:before.id,...after}};});return result.status===200?json(res,200,{service:result.service}):json(res,result.status,{error:result.error});
  }
  if(req.method==='POST'&&url.pathname==='/api/admin/unavailabilities'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req),start=new Date(body.startsAt),end=new Date(body.endsAt),now=new Date();if(!body.startsAt||!body.endsAt||!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||start.toISOString()!==body.startsAt||end.toISOString()!==body.endsAt||end<=start||start<now||typeof body.reason!=='string'||body.reason.trim().length>300)return json(res,400,{error:'invalid_unavailability'});
    const result=await withTransaction(db,async tx=>{await tx.lock?.('appointment-space:thomas-shop');const conflicts=await tx.prepare("SELECT id,starts_at AS startsAt,ends_at AS endsAt,status FROM appointments WHERE establishment_id='thomas-shop' AND status IN ('PENDING','CONFIRMED') AND starts_at<? AND ends_at>? ORDER BY starts_at").all(end.toISOString(),start.toISOString());if(conflicts.length)return {status:409,error:'appointments_conflict',appointments:conflicts};const id=crypto.randomUUID(),createdAt=now.toISOString();await tx.prepare('INSERT INTO unavailability(id,establishment_id,starts_at,ends_at,reason,created_by,created_at) VALUES(? ,\'thomas-shop\',?,?,?,?,?)').run(id,start.toISOString(),end.toISOString(),body.reason.trim(),session.user_id,createdAt);await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,after_json,result,created_at) VALUES(?,?,?,'UNAVAILABILITY_CREATED','UNAVAILABILITY',?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,'thomas-shop',id,JSON.stringify({startsAt:start.toISOString(),endsAt:end.toISOString(),reason:body.reason.trim()}),createdAt);return {status:201,id,startsAt:start.toISOString(),endsAt:end.toISOString(),reason:body.reason.trim()};});return result.status===201?json(res,201,{id:result.id,startsAt:result.startsAt,endsAt:result.endsAt,reason:result.reason}):json(res,409,{error:result.error,appointments:result.appointments});
  }
  const unavailabilityRoute=url.pathname.match(/^\/api\/admin\/unavailabilities\/([a-f0-9-]+)$/i);
  if(req.method==='DELETE'&&unavailabilityRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
    const removed=await withTransaction(db,async tx=>{await tx.lock?.('appointment-space:thomas-shop');const item=await tx.prepare("SELECT * FROM unavailability WHERE id=? AND establishment_id='thomas-shop'").get(unavailabilityRoute[1]);if(!item)return false;await tx.prepare('DELETE FROM unavailability WHERE id=?').run(item.id);await tx.prepare(`INSERT INTO audit_events(id,actor_id,establishment_id,action,object_type,object_id,before_json,result,created_at) VALUES(?,?,?,'UNAVAILABILITY_REMOVED','UNAVAILABILITY',?,?,'SUCCESS',?)`).run(crypto.randomUUID(),session.user_id,'thomas-shop',item.id,JSON.stringify(item),new Date().toISOString());return true;});return removed?json(res,200,{ok:true}):json(res,404,{error:'unavailability_not_found'});
  }
  const paymentCorrectionRoute=url.pathname.match(/^\/api\/admin\/appointments\/([a-f0-9-]+)\/payment\/correction$/i);
  if(req.method==='POST'&&paymentCorrectionRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});const body=await readBody(req);
   try{return json(res,200,await correctOnsitePayment(db,{appointmentId:paymentCorrectionRoute[1],actorId:session.user_id,expectedVersion:body.version,amountCents:body.amountCents,method:body.method||null,reason:body.reason}));}catch(error){return adminFailure(res,error);}
  }
  const appointmentRoute=url.pathname.match(/^\/api\/admin\/appointments\/([a-f0-9-]+)\/(status|payment)$/i);
  const appointmentModifyRoute=url.pathname.match(/^\/api\/admin\/appointments\/([^/]+)$/);
  if(req.method==='PATCH'&&appointmentModifyRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);try{return json(res,200,await modifyAppointment(db,{appointmentId:appointmentModifyRoute[1],actorId:session.user_id,expectedVersion:body.version,serviceId:body.serviceId,date:body.date,time:body.time}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='PATCH'&&appointmentRoute){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='ESTABLISHMENT_ADMIN')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req),appointment=(await db.prepare("SELECT establishment_id FROM appointments WHERE id=?").get(appointmentRoute[1]));if(!appointment||appointment.establishment_id!=='thomas-shop')return json(res,404,{error:'appointment_not_found'});
   try{if(appointmentRoute[2]==='status')return json(res,200,await transitionAppointment(db,{appointmentId:appointmentRoute[1],actorId:session.user_id,to:body.status,expectedVersion:body.version,reason:body.reason}));return json(res,200,await recordOnsitePayment(db,{appointmentId:appointmentRoute[1],actorId:session.user_id,expectedVersion:body.version,amountCents:body.amountCents,method:body.method||null}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/reviews')return json(res,200,{reviews:(await db.prepare("SELECT r.rating,r.comment,r.created_at AS createdAt FROM reviews r JOIN appointments a ON a.id=r.appointment_id WHERE r.status='PUBLISHED' AND a.establishment_id='thomas-shop' ORDER BY r.created_at DESC LIMIT 30").all())});
  if(req.method==='GET'&&url.pathname==='/api/shop') return json(res,200,{...shop,timezone:'Europe/Paris',hours:(await db.prepare("SELECT weekday,opens AS open,closes AS close FROM opening_hours WHERE establishment_id='thomas-shop' ORDER BY weekday").all()).map(item=>({...item,day:new Intl.DateTimeFormat('fr-FR',{weekday:'long',timeZone:'Europe/Paris'}).format(new Date(Date.UTC(2026,0,4+item.weekday,12)))})),services:await publicServices()});
  if(req.method==='GET'&&url.pathname==='/api/status'){const providers=providerStatus();let baseConfigured=false;try{publicBaseUrl();baseConfigured=true;}catch{}const adminReady=Boolean((await db.prepare("SELECT 1 FROM users u JOIN establishment_members m ON m.user_id=u.id JOIN admin_mfa f ON f.user_id=u.id WHERE u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL AND m.establishment_id='thomas-shop' AND m.role='ESTABLISHMENT_ADMIN' AND m.active=1 AND f.enabled=1 LIMIT 1").get()));const blockers=[];if(providers.email!=='CONFIGURED')blockers.push('EMAIL_PROVIDER_NOT_CONFIGURED');if(!baseConfigured)blockers.push('PUBLIC_HTTPS_URL_NOT_CONFIGURED');if(!mfaKey())blockers.push('MFA_ENCRYPTION_KEY_NOT_CONFIGURED');if(!adminReady)blockers.push('ADMIN_NOT_INITIALIZED');return json(res,200,{booking:blockers.length?'BLOCKED':'READY',blockers,emailProvider:providers.email,verificationMode:'EMAIL_ONLY_PHONE_CONTACT',smsAppointmentNotifications:'DISABLED',publicBaseUrl:baseConfigured?'CONFIGURED':'NOT_CONFIGURED',adminMfa:mfaKey()?'CONFIGURED':'NOT_CONFIGURED',admin:adminReady?'INITIALIZED':'NOT_INITIALIZED',database:db.kind});}
  if(req.method==='GET'&&url.pathname==='/api/availability/month'){
   const service=await findService(url.searchParams.get('service'),shop.id);if(!service)return json(res,404,{error:'service_not_found'});
   try{return json(res,200,await getMonthAvailability(db,{month:url.searchParams.get('month'),service}));}catch(error){return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname==='/api/availability'){
   const service=await findService(url.searchParams.get('service'),shop.id); if(!service)return json(res,404,{error:'service_not_found'});
   return json(res,200,await getDayAvailability(db,{date:url.searchParams.get('date'),service}));
  }
  if(req.method==='POST'&&url.pathname==='/api/bookings'){
   if(!checkSameOrigin(req))return json(res,403,{error:'origin_rejected'});const session=await sessionFor(req);if(!session||session.role!=='CLIENT')return json(res,401,{error:'authentication_required'});
   const body=await readBody(req);
   if(typeof body.serviceId!=='string'||typeof body.date!=='string'||typeof body.time!=='string'||typeof body.idempotencyKey!=='string')return json(res,400,{error:'invalid_booking_request'});
   try{const booking=await createBooking(db,{userId:session.user_id,serviceId:body.serviceId,date:body.date,time:body.time,idempotencyKey:body.idempotencyKey,rewardId:body.rewardId||null,expectedPriceCents:body.expectedPriceCents,expectedDurationMinutes:body.expectedDurationMinutes});return json(res,201,{booking,message:'Votre demande de réservation a bien été envoyée. Elle sera confirmée après validation par Thomas.'});}catch(error){if(error.code==='slot_unavailable')return json(res,409,{error:error.code,message:'Ce créneau vient d’être réservé. Merci de sélectionner un autre horaire.'});return adminFailure(res,error);}
  }
  if(req.method==='GET'&&url.pathname.startsWith('/api/')) return json(res,404,{error:'not_found'});
  const target=url.pathname==='/'?'/index.html':url.pathname;
  const filename=path.resolve(ROOT,'public',`.${target}`);
  if(!filename.startsWith(path.resolve(ROOT,'public')+path.sep))return json(res,404,{error:'not_found'});
  fs.readFile(filename,(err,data)=>{if(err){res.writeHead(404,SECURITY_HEADERS);res.end('Not found');return;}res.writeHead(200,{'content-type':MIME[path.extname(filename)]||'application/octet-stream',...SECURITY_HEADERS});res.end(data);});
 } catch(err){const status=err.message==='invalid_json'?400:(Number.isInteger(err.status)?err.status:500);json(res,status,{error:err.message==='invalid_json'?'invalid_json':'request_failed'});}
});
const port=Number(process.env.PORT||3000);
const host=process.env.CUTLY_HOST||(process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1');
const databaseReady=initializePostgres();
if(require.main===module){
 databaseReady.then(()=>{
  server.listen(port,host,()=>console.log(`CUTLY listening on ${host}:${server.address().port}`));
  if(emailConfigured()){const worker=setInterval(()=>processOutbox(db).catch(()=>console.error('CUTLY notification worker failed')),15_000);worker.unref();}
 }).catch(async error=>{console.error('CUTLY database initialization failed',error.code||'database_error');await db.close().catch(()=>{});process.exitCode=1;});
 let shuttingDown=false;function shutdown(){if(shuttingDown)return;shuttingDown=true;const timeout=setTimeout(()=>process.exit(1),10_000);timeout.unref();server.close(async()=>{await db.close();clearTimeout(timeout);process.exit(0);});}
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}

module.exports={server,databaseReady,db};
