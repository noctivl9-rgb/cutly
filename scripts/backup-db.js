const path=require('node:path');
const fs=require('node:fs');
const {DatabaseSync}=require('node:sqlite');

const source=path.resolve(process.env.CUTLY_DB_PATH||path.join(__dirname,'..','data','cutly.sqlite'));
const destinationArg=process.argv[2];
if(!destinationArg){console.error('Usage: node scripts/backup-db.js <nouveau-fichier-backup.sqlite>');process.exit(2);}
const destination=path.resolve(destinationArg);
if(source===destination){console.error('La destination ne peut pas remplacer la base active.');process.exit(2);}
if(!fs.existsSync(source)){console.error('Base source introuvable.');process.exit(2);}
if(fs.existsSync(destination)){console.error('La destination existe déjà; aucun fichier n’a été remplacé.');process.exit(2);}
if(!fs.existsSync(path.dirname(destination))){console.error('Le dossier de destination doit déjà exister.');process.exit(2);}

let sourceDb,backupDb;
try{
 sourceDb=new DatabaseSync(source,{readOnly:false});
 sourceDb.exec('PRAGMA wal_checkpoint(PASSIVE)');
 sourceDb.exec(`VACUUM INTO '${destination.replace(/'/g,"''")}'`);
 backupDb=new DatabaseSync(destination,{readOnly:true});
 const result=backupDb.prepare('PRAGMA integrity_check').get();
 if(result.integrity_check!=='ok')throw new Error('backup_integrity_check_failed');
 console.log(JSON.stringify({status:'verified',source,destination,integrity:'ok'}));
}catch(error){console.error(`Échec de sauvegarde ou vérification: ${error.message}`);process.exitCode=1;}
finally{backupDb?.close();sourceDb?.close();}
