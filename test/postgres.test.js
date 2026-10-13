const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {Client}=require('pg');
const {DatabaseSync}=require('node:sqlite');
const {createDatabase}=require('../lib/database');
const {migrate,TABLES}=require('../scripts/migrate-sqlite-to-postgres');
const {createBooking}=require('../lib/booking');
const {consumeAttempt}=require('../lib/rate-limit');
const {backupPostgres}=require('../scripts/backup-postgres');
const {refreshAppointmentReminders,processOutbox}=require('../lib/notifications');

test('real PostgreSQL: migration, concurrent booking, reminders and dump restoration', {skip:!process.env.CUTLY_TEST_POSTGRES_URL},async t=>{
 const root=new URL(process.env.CUTLY_TEST_POSTGRES_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(root.hostname),'Only an isolated local test server is permitted');
 const admin=new Client({connectionString:root.href});await admin.connect();
 const names=[],dir=fs.mkdtempSync(path.join(os.tmpdir(),'cutly-pg-test-'));let db,second;
 async function fresh(){const name=`cutly_test_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE DATABASE "${name}"`);names.push(name);const url=new URL(root);url.pathname=`/${name}`;return url.href;}
 try{
  const sqlite=path.join(dir,'source.sqlite');
  execFileSync(process.execPath,['-e',"const s=require('./server');s.databaseReady.then(()=>s.db.close()).catch(()=>process.exit(1))"],{cwd:path.join(__dirname,'..'),env:{...process.env,NODE_ENV:'test',CUTLY_DATABASE_URL:'',NETLIFY_DB_URL:'',CUTLY_DB_PATH:sqlite},stdio:'pipe'});
  const source=new DatabaseSync(sqlite);const stamp='2026-10-01T00:00:00.000Z';
  source.prepare("INSERT INTO users(id,email,phone,first_name,last_name,password_hash,email_verified_at,phone_verified_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run('client','client@example.test','+33600000001','Test','Client','NOT_A_REAL_LOGIN_HASH',stamp,stamp,stamp,stamp);source.close();
  const url=await fresh();
  await t.test('migration preserves every field and refuses a nonempty target',async()=>{
   const result=await migrate({sqlitePath:sqlite,backupPath:path.join(dir,'backup.sqlite'),databaseUrl:url});assert.equal(result.counts.users,1);
   await assert.rejects(migrate({sqlitePath:sqlite,backupPath:path.join(dir,'second-backup.sqlite'),databaseUrl:url}),/postgres_target_must_be_empty/);
  });
  db=createDatabase({url});second=createDatabase({url});
  await t.test('camelCase SQL aliases survive PostgreSQL folding',async()=>{assert.deepEqual(await db.prepare("SELECT 500 AS priceCents, 'AS notAnAlias ?' AS label").get(),{priceCents:500,label:'AS notAnAlias ?'});});
  const input={userId:'client',serviceId:'coupe-classique',date:'2026-10-17',time:'09:00',now:new Date(stamp)};
  await t.test('two concurrent connections cannot reserve the same interval',async()=>{
   const results=await Promise.allSettled([createBooking(db,{...input,idempotencyKey:randomUUID()}),createBooking(second,{...input,idempotencyKey:randomUUID()})]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'slot_unavailable');
  });
  await t.test('concurrent retries return exactly the same booking',async()=>{
   const request={...input,time:'10:00',idempotencyKey:randomUUID()};const [a,b]=await Promise.all([createBooking(db,request),createBooking(second,request)]);assert.deepEqual(a,b);
  });
  await t.test('database trigger rejects concurrent overlapping writes outside the booking service',async()=>{
   const insert=conn=>conn.prepare(`INSERT INTO appointments(id,establishment_id,service_id,client_name,client_email,starts_at,ends_at,timezone,service_name_snapshot,price_cents_snapshot,duration_minutes_snapshot,status,created_at)
    VALUES(?,'thomas-shop','coupe-classique','Test','raw@example.test','2026-10-18T08:00:00.000Z','2026-10-18T08:30:00.000Z','Europe/Paris','Coupe classique',500,30,'PENDING',?)`).run(randomUUID(),stamp);
   const results=await Promise.allSettled([insert(db),insert(second)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'SQLITE_CONSTRAINT_TRIGGER');
  });
  await t.test('rate limits are shared across connections and expire',async()=>{
   const attempts=await Promise.all(Array.from({length:12},(_,i)=>consumeAttempt(i%2?db:second,'test-limit',3,1000,10000)));
   assert.equal(attempts.filter(Boolean).length,3);assert.equal(await consumeAttempt(second,'test-limit',3,1000,11001),true);
  });
  await t.test('SMS reminders have due times, refresh is idempotent, cancellation invalidates them',async()=>{
   const old=process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS='true';
   try{
    const a=await db.prepare('SELECT * FROM appointments ORDER BY starts_at LIMIT 1').get();await db.prepare("UPDATE appointments SET status='CONFIRMED' WHERE id=?").run(a.id);a.status='CONFIRMED';
    await refreshAppointmentReminders(db,a,{now:new Date(stamp)});await refreshAppointmentReminders(db,a,{now:new Date(stamp)});
    const rows=await db.prepare("SELECT * FROM notification_outbox WHERE kind LIKE 'reminder:%'").all();assert.equal(rows.length,4);assert.ok(rows.every(r=>r.status==='PENDING'&&r.next_attempt_at));
    for(const r of rows)assert.equal(Date.parse(r.next_attempt_at),Date.parse(a.starts_at)-(r.kind.includes('24h')?24:2)*3600000);
    await db.prepare("UPDATE appointments SET status='CANCELLED' WHERE id=?").run(a.id);
    let remindersSent=0;await processOutbox(db,{now:new Date('2026-10-17T06:30:00Z'),deliver:async m=>{if(m.text.includes('rappel')||m.text.includes('Rappel'))remindersSent++;return {id:'TEST_ONLY',provider:'TEST_DOUBLE'};}});
    assert.equal(remindersSent,0);assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM notification_outbox WHERE kind LIKE 'reminder:%' AND status='OBSOLETE'").get()).count,4);
   }finally{if(old===undefined)delete process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS;else process.env.CUTLY_SMS_APPOINTMENT_NOTIFICATIONS=old;}
  });
  await t.test('pg_dump archive restores all table contents into a separate fresh database',{skip:!process.env.CUTLY_TEST_PG_BIN},async()=>{
   const restored=await fresh(),target=new URL(restored),bin=process.env.CUTLY_TEST_PG_BIN;
   const env={...process.env,PGHOST:root.hostname,PGPORT:root.port,PGUSER:decodeURIComponent(root.username),PGPASSWORD:decodeURIComponent(root.password),PGDATABASE:new URL(url).pathname.slice(1)};
   const dump=path.join(dir,'roundtrip.dump');assert.equal(backupPostgres({databaseUrl:url,destination:dump,binDirectory:bin}).archiveReadable,true);
   assert.throws(()=>backupPostgres({databaseUrl:url,destination:dump,binDirectory:bin}),{code:'EEXIST'});
   execFileSync(path.join(bin,'pg_restore'),['--exit-on-error','--no-owner','--dbname',target.pathname.slice(1),dump],{env,stdio:'pipe'});
   const copy=createDatabase({url:restored});try{const canonical=rows=>rows.map(row=>JSON.stringify(Object.keys(row).sort().map(k=>[k,row[k]]))).sort();for(const table of TABLES)assert.deepEqual(canonical(await copy.prepare(`SELECT * FROM "${table}"`).all()),canonical(await db.prepare(`SELECT * FROM "${table}"`).all()),table);}finally{await copy.close();}
  });
 }finally{
  if(db)await db.close();if(second)await second.close();
  for(const name of names)await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();fs.rmSync(dir,{recursive:true,force:true});
 }
});
