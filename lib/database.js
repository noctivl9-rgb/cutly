const { Pool, types } = require('pg');

types.setTypeParser(20, value => Number(value));

function parameterize(sql) {
 let output='',index=0,state='normal',dollarTag='';
 for(let i=0;i<sql.length;i++){
  const char=sql[i],next=sql[i+1];
  if(state==='single'){output+=char;if(char==="'"&&next==="'"){output+=next;i++;}else if(char==="'")state='normal';continue;}
  if(state==='double'){output+=char;if(char==='"'&&next==='"'){output+=next;i++;}else if(char==='"')state='normal';continue;}
  if(state==='line'){output+=char;if(char==='\n')state='normal';continue;}
  if(state==='block'){output+=char;if(char==='*'&&next==='/'){output+=next;i++;state='normal';}continue;}
  if(state==='dollar'){if(sql.startsWith(dollarTag,i)){output+=dollarTag;i+=dollarTag.length-1;state='normal';}else output+=char;continue;}
  if(char==="'"){state='single';output+=char;continue;}
  if(char==='"'){state='double';output+=char;continue;}
  if(char==='-'&&next==='-'){state='line';output+=char+next;i++;continue;}
  if(char==='/'&&next==='*'){state='block';output+=char+next;i++;continue;}
  if(char==='$'){
   const match=sql.slice(i).match(/^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/);
   if(match){dollarTag=match[0];state='dollar';output+=dollarTag;i+=dollarTag.length-1;continue;}
  }
  if(char==='?'){output+=`$${++index}`;continue;}
  // PostgreSQL folds unquoted aliases; preserve the API's camelCase field names.
  if ((i === 0 || /\s/.test(sql[i-1])) && /^AS\s/i.test(sql.slice(i))) {
   const alias=sql.slice(i).match(/^AS\s+([a-z][A-Za-z0-9_]*)\b/i);
   if(alias && /[a-z]/.test(alias[1]) && /[A-Z]/.test(alias[1])) {
    output+=`AS "${alias[1]}"`;i+=alias[0].length-1;continue;
   }
  }
  output+=char;
 }
 return output;
}

function postgresSql(sql){
 let query=sql.trim().replace(/^BEGIN\s+IMMEDIATE\s*;?$/i,'BEGIN');
 const ignore=/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s/i.test(query);
 if(ignore)query=query.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s/i,'INSERT INTO ');
 if(ignore)query=`${query.replace(/;\s*$/,'').trimEnd()} ON CONFLICT DO NOTHING`;
 return parameterize(query);
}

function normalizePgError(error){
 if(error.code==='23505')error.code='SQLITE_CONSTRAINT_UNIQUE';
 else if(error.code==='23503')error.code='SQLITE_CONSTRAINT_FOREIGNKEY';
 else if(error.code==='23514')error.code='SQLITE_CONSTRAINT_CHECK';
 else if(error.code==='23P01')error.code='SQLITE_CONSTRAINT_TRIGGER';
 return error;
}

function pgStatement(client,sql){
 const query=postgresSql(sql);
 const runQuery=async(values)=>{try{return await client.query(query,values);}catch(error){throw normalizePgError(error);}};
 return {
  get:async(...values)=>{const result=await runQuery(values);return result.rows[0];},
  all:async(...values)=>(await runQuery(values)).rows,
  run:async(...values)=>{const result=await runQuery(values);return {changes:result.rowCount,lastInsertRowid:undefined};}
 };
}

function sqliteStatement(database,sql,transactional=false){
 const statement=database.sqlite.prepare(sql);
 const invoke=fn=>transactional?fn():database.sqliteQuery(fn);
 return {
  get:(...values)=>invoke(()=>statement.get(...values)),
  all:(...values)=>invoke(()=>statement.all(...values)),
  run:(...values)=>invoke(()=>statement.run(...values))
 };
}

class Database {
 constructor({url,sqlitePath}){
  this.kind=url?'POSTGRES':'SQLITE';
  this.sqliteTail=Promise.resolve();
  if(url){const configuredPoolSize=Number(process.env.CUTLY_DB_POOL_MAX);const max=Number.isInteger(configuredPoolSize)&&configuredPoolSize>=1&&configuredPoolSize<=20?configuredPoolSize:(process.env.NETLIFY?2:10);this.pool=new Pool({connectionString:url,max,idleTimeoutMillis:30_000,connectionTimeoutMillis:10_000,application_name:'cutly'});}
  else {const { DatabaseSync } = require('node:sqlite');this.sqlite=new DatabaseSync(sqlitePath);}
 }
 prepare(sql){return this.kind==='POSTGRES'?pgStatement(this.pool,sql):sqliteStatement(this,sql);}
 async exec(sql){
  if(this.kind==='SQLITE')return this.sqliteQuery(()=>this.sqlite.exec(sql));
  try{await this.pool.query(sql);}catch(error){throw normalizePgError(error);}
 }
 async transaction(callback){
  this.savepointCounter=(this.savepointCounter||0)+1;
  if(this.kind==='POSTGRES'){
   const client=await this.pool.connect();
   try{
    await client.query('BEGIN');
    const tx={
     kind:'POSTGRES',
     prepare:sql=>pgStatement(client,sql),
     exec:async sql=>{try{await client.query(sql);}catch(error){throw normalizePgError(error);}},
     lock:async key=>{try{await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[String(key)]);}catch(error){throw normalizePgError(error);}},
     transaction:async nestedCallback=>{
      const savepoint=`cutly_sp_${++this.savepointCounter}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try{const value=await nestedCallback(tx);await client.query(`RELEASE SAVEPOINT ${savepoint}`);return value;}
      catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);await client.query(`RELEASE SAVEPOINT ${savepoint}`);throw error;}
     }
    };
    const value=await callback(tx);
    await client.query('COMMIT');
    return value;
   }catch(error){try{await client.query('ROLLBACK');}catch{}throw normalizePgError(error);}
   finally{client.release();}
  }
  const release=await this.acquireSqlite();
  try{
   this.sqlite.exec('BEGIN IMMEDIATE');
   const tx={
    kind:'SQLITE',
    prepare:sql=>sqliteStatement(this,sql,true),
    exec:async sql=>this.sqlite.exec(sql),
    lock:async()=>{},
    transaction:async nestedCallback=>{
     const savepoint=`cutly_sp_${++this.savepointCounter}`;
     this.sqlite.exec(`SAVEPOINT ${savepoint}`);
     try{const value=await nestedCallback(tx);this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);return value;}
     catch(error){this.sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint}`);throw error;}
    }
   };
   const value=await callback(tx);
   this.sqlite.exec('COMMIT');
   return value;
  }catch(error){try{this.sqlite.exec('ROLLBACK');}catch{}throw error;}
  finally{release();}
 }
 async sqliteQuery(fn){
  const release=await this.acquireSqlite();
  try{return fn();}finally{release();}
 }
 async acquireSqlite(){
  let releaseNext;
  const next=new Promise(resolve=>{releaseNext=resolve;});
  const previous=this.sqliteTail;
  this.sqliteTail=previous.then(()=>next);
  await previous;
  let released=false;
  return ()=>{if(!released){released=true;releaseNext();}};
 }
 async close(){if(this.kind==='POSTGRES')await this.pool.end();else this.sqlite.close();}
}

async function withTransaction(database,callback){
 if(typeof database.transaction==='function')return database.transaction(callback);
 database.exec('BEGIN IMMEDIATE');
 try{const value=await callback(database);database.exec('COMMIT');return value;}
 catch(error){try{database.exec('ROLLBACK');}catch{}throw error;}
}

function createDatabase({url=process.env.CUTLY_DATABASE_URL||process.env.DATABASE_URL||process.env.NETLIFY_DB_URL,sqlitePath=process.env.CUTLY_DB_PATH}={}){
 return new Database({url,sqlitePath});
}

module.exports={Database,createDatabase,withTransaction,parameterize,postgresSql};
