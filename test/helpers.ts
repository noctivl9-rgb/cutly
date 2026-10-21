// Démarre une instance réelle (HTTP + PostgreSQL embarqué) pour les tests.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server.ts';

export interface TestApp {
  base: string;
  dataDir: string;
  j: (path: string, opts?: { method?: string; body?: unknown; player?: string; organizer?: string; admin?: string }) => Promise<{ status: number; data: any }>;
  raw: (path: string, opts?: { method?: string; body?: unknown; admin?: string; organizer?: string }) => Promise<Response>;
  close: (opts?: { keepData?: boolean }) => Promise<void>;
}

export async function startApp(opts: { dataDir?: string } = {}): Promise<TestApp> {
  process.env.DX_ADMIN_EMAIL = 'admin@dossier-x.test';
  process.env.DX_ADMIN_PASSWORD = 'mot-de-passe-de-test-123';
  const dataDir = opts.dataDir ?? (await mkdtemp(join(tmpdir(), 'dx-test-')));
  const { server, db } = await createApp({ dataDir: join(dataDir, 'pg') });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = (o: any) => ({
    'content-type': 'application/json',
    ...(o?.player ? { 'x-dx-player': o.player } : {}),
    ...(o?.organizer ? { 'x-dx-organizer': o.organizer } : {}),
    ...(o?.admin ? { 'x-dx-admin': o.admin } : {}),
  });
  const raw: TestApp['raw'] = (path, o = {}) => fetch(base + path, { method: o.method ?? 'GET', headers: headers(o), body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const j: TestApp['j'] = async (path, o = {}) => {
    const res = await fetch(base + path, { method: o.method ?? 'GET', headers: headers(o), body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  return {
    base, dataDir, j, raw,
    async close({ keepData } = {}) {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
      await db.close();
      if (!keepData) await rm(dataDir, { recursive: true, force: true });
    },
  };
}

/** Lit un flux SSE et collecte les événements de jeu. */
export function openStream(url: string, headers: Record<string, string>) {
  const events: any[] = [];
  const ctrl = new AbortController();
  let ready!: () => void;
  const readyP = new Promise<void>((r) => (ready = r));
  (async () => {
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (chunk.includes('event: ready')) ready();
          const data = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (chunk.includes('event: game') && data) events.push(JSON.parse(data.slice(5)));
        }
      }
    } catch { /* fermeture */ }
  })();
  return {
    events,
    ready: readyP,
    async waitFor(pred: (e: any) => boolean, ms = 3000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const found = events.find(pred);
        if (found) return found;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error('Événement non reçu');
    },
    close: () => ctrl.abort(),
  };
}

export const CHARACTERS = ['PER-HELENE', 'PER-VICTOR', 'PER-CAMILLE', 'PER-ARTHUR', 'PER-JULIEN', 'PER-MARGAUX'];
