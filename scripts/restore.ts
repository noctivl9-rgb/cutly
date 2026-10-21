// Restaure une sauvegarde JSON dans une base VIDE (schéma créé par les migrations).
// Usage : npm run restore -- chemin/du/fichier.json
import { readFile } from 'node:fs/promises';
import { openDatabase } from '../src/db.ts';
import { TABLES } from './tables.ts';

const file = process.argv[2];
if (!file) {
  console.error('Usage : npm run restore -- sauvegarde.json');
  process.exit(1);
}
const data = JSON.parse(await readFile(file, 'utf8'));
if (data.format !== 'dossier-x-backup') throw new Error('Fichier de sauvegarde non reconnu.');
const db = await openDatabase();
const existing = await db.one<{ n: number }>('select count(*)::int as n from games');
const scenarios = await db.one<{ n: number }>('select count(*)::int as n from scenarios');
if ((existing?.n ?? 0) > 0) {
  console.error('La base contient déjà des parties : restaurez dans une base vide.');
  process.exit(1);
}
const jsonCols = new Map<string, Set<string>>();
for (const row of await db.q(`select table_name, column_name from information_schema.columns where data_type = 'jsonb' and table_schema = current_schema()`)) {
  if (!jsonCols.has(row.table_name)) jsonCols.set(row.table_name, new Set());
  jsonCols.get(row.table_name)!.add(row.column_name);
}
await db.tx(async (q) => {
  // Le serveur importe le scénario de démonstration au démarrage : on repart d'une base réellement vide.
  if ((scenarios?.n ?? 0) > 0) for (const t of [...TABLES].reverse()) await q(`delete from ${t}`);
  for (const t of TABLES) {
    for (const row of data.tables[t] ?? []) {
      const cols = Object.keys(row);
      const vals = cols.map((c) => (jsonCols.get(t)?.has(c) ? JSON.stringify(row[c]) : row[c]));
      await q(`insert into ${t} (${cols.join(', ')}) values (${cols.map((c, i) => `$${i + 1}${jsonCols.get(t)?.has(c) ? '::jsonb' : ''}`).join(', ')})`, vals);
    }
  }
  for (const t of ['game_events', 'scans', 'audit_log']) await q(`select setval(pg_get_serial_sequence('${t}', 'id'), coalesce((select max(id) from ${t}), 1))`);
});
await db.close();
console.log(`Restauration terminée depuis ${file}.`);
