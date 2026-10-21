// Sauvegarde logique complète de la base en JSON (fonctionne avec PostgreSQL et PGlite).
// Usage : npm run backup [-- chemin/du/fichier.json]
// Avec PGlite, arrêtez d'abord le serveur (le répertoire de données est verrouillé).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openDatabase } from '../src/db.ts';
import { TABLES } from './tables.ts';

const out = process.argv[2] ?? join('backups', `dossier-x-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const db = await openDatabase();
const dump: Record<string, unknown[]> = {};
for (const t of TABLES) dump[t] = await db.q(`select * from ${t}`);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ format: 'dossier-x-backup', version: 1, createdAt: new Date().toISOString(), tables: dump }));
await db.close();
console.log(`Sauvegarde écrite : ${out} (${Object.values(dump).reduce((n, r) => n + r.length, 0)} lignes)`);
