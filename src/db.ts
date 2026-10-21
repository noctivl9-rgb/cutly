// Accès base de données : PostgreSQL réseau (DATABASE_URL) ou PostgreSQL embarqué (PGlite)
// pour le développement local et les tests. Les deux exécutent le même SQL.
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export type Row = Record<string, any>;
export type Query = <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T[]>;

export interface Database {
  kind: 'postgres' | 'pglite';
  q: Query;
  one: <T extends Row = Row>(sql: string, params?: unknown[]) => Promise<T | undefined>;
  tx: <T>(fn: (q: Query) => Promise<T>) => Promise<T>;
  /** Exécute un script SQL multi-instructions dans une transaction (migrations). */
  script: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'db', 'migrations');

export async function openDatabase(opts: { url?: string; dataDir?: string } = {}): Promise<Database> {
  const url = opts.url ?? process.env.DATABASE_URL;
  const db = url ? await openPostgres(url) : await openPglite(opts.dataDir ?? process.env.PGLITE_DIR ?? './data/pglite');
  await migrate(db);
  return db;
}

async function openPostgres(url: string): Promise<Database> {
  const { default: pg } = await import('pg');
  const ssl = /sslmode=require|neon\.tech|supabase\.co|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.PG_POOL_MAX ?? 10) });
  const q: Query = async (sql, params = []) => (await pool.query(sql, params as any[])).rows;
  return {
    kind: 'postgres',
    q,
    one: async (sql, params) => (await q(sql, params))[0] as any,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await fn(async (sql, params = []) => (await client.query(sql, params as any[])).rows);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async script(sql) {
      const client = await pool.connect();
      try {
        await client.query(`begin;\n${sql}\n;commit;`);
      } catch (err) {
        await client.query('rollback').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dataDir: string): Promise<Database> {
  const { PGlite } = await import('@electric-sql/pglite');
  if (dataDir !== 'memory') await mkdir(dirname(dataDir), { recursive: true });
  const pg = new PGlite(dataDir === 'memory' ? undefined : dataDir);
  await pg.waitReady;
  const q: Query = async (sql, params = []) => (await pg.query(sql, params as any[])).rows as any[];
  return {
    kind: 'pglite',
    q,
    one: async (sql, params) => (await q(sql, params))[0] as any,
    tx: (fn) => pg.transaction((tx) => fn(async (sql, params = []) => (await tx.query(sql, params as any[])).rows as any[])),
    script: async (sql) => {
      await pg.transaction(async (tx) => {
        await tx.exec(sql);
      });
    },
    close: () => pg.close(),
  };
}

async function migrate(db: Database) {
  await db.q('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.q<{ id: string }>('select id from schema_migrations')).map((r) => r.id));
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
    await db.script(`${sql}\n;insert into schema_migrations (id) values ('${file.replace(/'/g, "''")}');`);
  }
}

export function isUniqueViolation(err: unknown, constraint?: string) {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code !== '23505') return false;
  return !constraint || e.constraint === constraint || (e.message ?? '').includes(constraint);
}
