// Outils HTTP : erreurs, routage, corps JSON, limitation de débit, fichiers statiques.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export class HttpError extends Error {
  status: number;
  extra?: Record<string, unknown>;
  constructor(status: number, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  body: () => Promise<any>;
}

type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

export class Router {
  private routes: Array<{ method: string; re: RegExp; keys: string[]; handler: Handler }> = [];
  on(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:([a-zA-Z]+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '/?$');
    this.routes.push({ method, re, keys, handler });
    return this;
  }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  put(p: string, h: Handler) { return this.on('PUT', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }
  match(method: string, pathname: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(pathname);
      if (m) return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

export async function readJson(req: IncomingMessage, limit = 256 * 1024): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'JSON invalide');
  }
}

export function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function securityHeaders(res: ServerResponse) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(self), geolocation=()');
  res.setHeader(
    'content-security-policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
  );
}

// ── Limitation de débit (fenêtre glissante en mémoire, par instance) ──
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  max = Math.ceil(max * Number(process.env.DX_RATE_LIMIT_SCALE ?? 1)); // relevé uniquement par les tests automatisés
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    throw new HttpError(429, 'Trop de tentatives. Patientez quelques instants.', { retryAfterMs: windowMs - (now - hits[0]) });
  }
  hits.push(now);
  buckets.set(key, hits);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, hits] of buckets) if (!hits.some((t) => now - t < 3600_000)) buckets.delete(k);
}, 600_000).unref();

// ── Fichiers statiques ──
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
};

export async function serveStatic(res: ServerResponse, root: string, pathname: string): Promise<boolean> {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  const file = join(root, rel);
  if (!file.startsWith(root + sep) && file !== root) return false;
  try {
    const s = await stat(file);
    if (!s.isFile()) return false;
    const ext = extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': s.size,
      'cache-control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(file).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export function clientIp(req: IncomingMessage) {
  const fwd = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || 'unknown';
}
