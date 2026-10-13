const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const PASSWORD_COST=32768,PASSWORD_BLOCK_SIZE=8,PASSWORD_PARALLEL=1;
const SESSION_COOKIE='cutly_session',SESSION_TTL_MS=8*60*60*1000;

async function hashPassword(password){
 if(typeof password!=='string'||Buffer.byteLength(password,'utf8')<12||Buffer.byteLength(password,'utf8')>1024)throw new Error('invalid_password_length');
 const salt=crypto.randomBytes(16),derived=await scrypt(password,salt,64,{N:PASSWORD_COST,r:PASSWORD_BLOCK_SIZE,p:PASSWORD_PARALLEL,maxmem:64*1024*1024});
 return `scrypt$${PASSWORD_COST}$${PASSWORD_BLOCK_SIZE}$${PASSWORD_PARALLEL}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}
async function verifyPassword(password,encoded){
 try{
  if(typeof password!=='string'||Buffer.byteLength(password,'utf8')>1024)return false;
  const [kind,n,r,p,saltText,hashText]=encoded.split('$');
  const N=Number(n),block=Number(r),parallel=Number(p);
  if(kind!=='scrypt'||!Number.isInteger(N)||N<16384||N>65536||!Number.isInteger(block)||block<1||block>16||!Number.isInteger(parallel)||parallel<1||parallel>4)return false;
  const expected=Buffer.from(hashText,'base64url'),salt=Buffer.from(saltText,'base64url');
  if(expected.length!==64||salt.length<16||salt.length>32)return false;
  const actual=await scrypt(password,salt,expected.length,{N,r:block,p:parallel,maxmem:64*1024*1024});
  return crypto.timingSafeEqual(actual,expected);
 }catch{return false;}
}
function decodeBase32(value){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',clean=value.toUpperCase().replace(/=+$/,'');let buffer=0,bits=0,out=[];
 for(const char of clean){const digit=alphabet.indexOf(char);if(digit<0)throw new Error('invalid_totp_secret');buffer=(buffer<<5)|digit;bits+=5;if(bits>=8){out.push((buffer>>>(bits-8))&255);bits-=8;}}
 return Buffer.from(out);
}
function encodeBase32(bytes){let buffer=0,bits=0,out='',alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';for(const byte of bytes){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(buffer>>>(bits-5))&31];bits-=5;}}if(bits)out+=alphabet[(buffer<<(5-bits))&31];return out;}
function totp(secret,step){
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const digest=crypto.createHmac('sha1',decodeBase32(secret)).update(counter).digest();
 const offset=digest[digest.length-1]&15;const binary=digest.readUInt32BE(offset)&0x7fffffff;return String(binary%1_000_000).padStart(6,'0');
}
function encryptTotpSecret(secret,key){
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,nonce),encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
 return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
function decryptTotpSecret(envelope,key){
 const [version,nonce,tag,ciphertext]=envelope.split('.');if(version!=='v1')throw new Error('invalid_mfa_secret');
 const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(nonce,'base64url'));decipher.setAuthTag(Buffer.from(tag,'base64url'));
 return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64url')),decipher.final()]).toString('utf8');
}
function mfaKey(){const value=process.env.CUTLY_MFA_ENCRYPTION_KEY;if(!value)return null;try{const key=Buffer.from(value,'base64');return key.length===32?key:null;}catch{return null;}}
async function verifyAndConsumeTotp(db,userId,code,now=new Date()){
 if(!/^\d{6}$/.test(String(code)))return false;const key=mfaKey();if(!key)return false;
 const record=await db.prepare('SELECT secret_encrypted,last_used_step FROM admin_mfa WHERE user_id=? AND enabled=1').get(userId);if(!record)return false;
 let secret;try{secret=decryptTotpSecret(record.secret_encrypted,key);}catch{return false;}
 const current=Math.floor(now.getTime()/30000);
 for(const step of [current,current-1,current+1]){
  if(step<=record.last_used_step)continue;
  const expected=totp(secret,step),a=Buffer.from(expected),b=Buffer.from(String(code));
  if(a.length===b.length&&crypto.timingSafeEqual(a,b))return (await db.prepare('UPDATE admin_mfa SET last_used_step=? WHERE user_id=? AND last_used_step<?').run(step,userId,step)).changes===1;
 }
 return false;
}
function sessionTokenHash(token){return crypto.createHash('sha256').update(token).digest('hex');}
async function createSession(db,userId,userAgent,now=new Date()){
 const token=crypto.randomBytes(32).toString('base64url'),created=now.toISOString(),expires=new Date(now.getTime()+SESSION_TTL_MS).toISOString();
 await db.prepare('INSERT INTO sessions(id_hash,user_id,created_at,expires_at,user_agent) VALUES(?,?,?,?,?)').run(sessionTokenHash(token),userId,created,expires,typeof userAgent==='string'?userAgent.slice(0,300):null);
 return {token,expiresAt:expires};
}
async function sessionFromRequest(db,req,now=new Date()){
 const header=req.headers.cookie||'',pair=header.split(';').map(v=>v.trim()).find(v=>v.startsWith(`${SESSION_COOKIE}=`));
 if(!pair)return null;const token=pair.slice(SESSION_COOKIE.length+1);if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))return null;
 const session=await db.prepare(`SELECT s.id_hash,s.user_id,s.expires_at,u.email,u.role,u.disabled_at FROM sessions s JOIN users u ON u.id=s.user_id
  WHERE s.id_hash=? AND s.revoked_at IS NULL AND s.expires_at>?`).get(sessionTokenHash(token),now.toISOString());
 if(!session||session.disabled_at)return null;
 if(session.role==='ESTABLISHMENT_ADMIN'&&!await db.prepare("SELECT 1 FROM establishment_members WHERE user_id=? AND establishment_id='thomas-shop' AND role='ESTABLISHMENT_ADMIN' AND active=1").get(session.user_id))return null;
 return session;
}
function cookieHeader(token,maxAge=SESSION_TTL_MS/1000){const secure=process.env.NODE_ENV==='production'?'; Secure':'';return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;}
async function logout(db,session,now=new Date()){if(session)await db.prepare('UPDATE sessions SET revoked_at=? WHERE id_hash=? AND revoked_at IS NULL').run(now.toISOString(),session.id_hash);}

module.exports={hashPassword,verifyPassword,encodeBase32,totp,encryptTotpSecret,decryptTotpSecret,mfaKey,verifyAndConsumeTotp,createSession,sessionFromRequest,cookieHeader,logout,SESSION_COOKIE};
