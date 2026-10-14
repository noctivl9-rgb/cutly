const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

function backupPostgres({databaseUrl,destination,binDirectory=''}){
 if(!databaseUrl||!destination)throw new Error('database_url_and_new_destination_required');
 const url=new URL(databaseUrl);
 if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('invalid_database_url');
 const output=path.resolve(destination);
 fs.mkdirSync(path.dirname(output),{recursive:true});
 const fd=fs.openSync(output,'wx',0o600);
 const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:url.searchParams.get('sslmode')||(['localhost','127.0.0.1','[::1]'].includes(url.hostname)?'prefer':'verify-full')};
 try{
  execFileSync(path.join(binDirectory,'pg_dump'),['--format=custom','--no-password'],{env,stdio:['ignore',fd,'pipe'],windowsHide:true});
 }catch{throw new Error('postgres_backup_failed_partial_file_retained');}
 finally{fs.closeSync(fd);}
 try{execFileSync(path.join(binDirectory,'pg_restore'),['--list',output],{env,stdio:'pipe',windowsHide:true});}
 catch{throw new Error('postgres_archive_validation_failed');}
 return {path:output,archiveReadable:true,restorationTested:false};
}
if(require.main===module){
 try{console.log(JSON.stringify(backupPostgres({databaseUrl:process.env.CUTLY_DATABASE_URL||process.env.DATABASE_URL||process.env.NETLIFY_DB_URL,destination:process.argv[2],binDirectory:process.env.CUTLY_PG_BIN||''})));}
 catch(error){console.error(error.code==='EEXIST'?'backup_destination_already_exists':error.message.startsWith('postgres_')?error.message:'backup_configuration_invalid');process.exitCode=1;}
}
module.exports={backupPostgres};
