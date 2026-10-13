const {createHash}=require('node:crypto');
const {withTransaction}=require('./database');
async function consumeAttempt(db,key,limit=5,windowMs=900000,now=Date.now()){
 const hash=createHash('sha256').update(key).digest('hex');
 return withTransaction(db,async tx=>{
  await tx.lock?.(`rate-limit:${hash}`);
  const row=await tx.prepare('SELECT attempts,expires_at FROM rate_limits WHERE key_hash=?').get(hash);
  if(row&&row.expires_at>now&&row.attempts>=limit)return false;
  const count=row&&row.expires_at>now?row.attempts+1:1,until=row&&row.expires_at>now?row.expires_at:now+windowMs;
  await tx.prepare('INSERT INTO rate_limits(key_hash,attempts,expires_at) VALUES(?,?,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=excluded.attempts,expires_at=excluded.expires_at').run(hash,count,until);
  await tx.prepare('DELETE FROM rate_limits WHERE expires_at<=?').run(now);
  return true;
 });
}
module.exports={consumeAttempt};
