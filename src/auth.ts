// Identités : administrateurs (mot de passe), organisateurs de partie et joueurs (jetons opaques).
// Seule l'empreinte SHA-256 d'un jeton est stockée en base.
import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { IncomingMessage } from 'node:http';
import type { Database } from './db.ts';
import { HttpError } from './http.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const newToken = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < 8; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
export const normalizeRecovery = (code: string) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(.{4})(.{4})$/, '$1-$2');
export const hashRecovery = (gameId: string, code: string) => hashToken(`${gameId}:${normalizeRecovery(code)}`);

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [alg, salt, key] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

function header(req: IncomingMessage, name: string) {
  const v = req.headers[name];
  return typeof v === 'string' && v.length < 200 ? v : '';
}

export interface Admin { id: string; email: string; role: 'superadmin' | 'author' }
export interface Player { id: string; game_id: string; nickname: string; character_ref: string | null }
export interface OrganizerActor { actor: string; admin?: Admin }

export async function getAdmin(db: Database, req: IncomingMessage): Promise<Admin | null> {
  const token = header(req, 'x-dx-admin');
  if (!token) return null;
  const row = await db.one(
    `select a.id, a.email, a.role from admin_sessions s join admins a on a.id = s.admin_id
     where s.token_hash = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );
  return (row as Admin) ?? null;
}

export async function requireAdmin(db: Database, req: IncomingMessage, roles: Array<Admin['role']> = ['superadmin', 'author']) {
  const admin = await getAdmin(db, req);
  if (!admin) throw new HttpError(401, 'Connexion administrateur requise.');
  if (!roles.includes(admin.role)) throw new HttpError(403, 'Droits insuffisants.');
  return admin;
}

export async function getPlayer(db: Database, req: IncomingMessage): Promise<Player | null> {
  const token = header(req, 'x-dx-player');
  if (!token) return null;
  const row = await db.one('select id, game_id, nickname, character_ref from players where token_hash = $1', [hashToken(token)]);
  return (row as Player) ?? null;
}

export async function requirePlayer(db: Database, req: IncomingMessage, gameId: string): Promise<Player> {
  const player = await getPlayer(db, req);
  if (!player) throw new HttpError(401, 'Identité de joueur requise. Rejoignez la partie ou récupérez votre accès.');
  if (player.game_id !== gameId) throw new HttpError(403, "Vous n'appartenez pas à cette partie.");
  return player;
}

/** Organisateur de CETTE partie (jeton d'organisateur) ou administrateur global. */
export async function getOrganizer(db: Database, req: IncomingMessage, gameId: string): Promise<OrganizerActor | null> {
  const token = header(req, 'x-dx-organizer');
  if (token) {
    const row = await db.one('select id from game_organizers where token_hash = $1 and game_id = $2', [hashToken(token), gameId]);
    if (row) return { actor: `organizer:${row.id}` };
  }
  const admin = await getAdmin(db, req);
  if (admin?.role === 'superadmin') return { actor: `admin:${admin.id}`, admin };
  return null;
}

export async function requireOrganizer(db: Database, req: IncomingMessage, gameId: string) {
  const org = await getOrganizer(db, req, gameId);
  if (!org) throw new HttpError(403, "Action réservée à l'organisateur de cette partie.");
  return org;
}

export async function createAdmin(db: Database, email: string, password: string, role: Admin['role']) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (password.length < 12) throw new HttpError(400, 'Le mot de passe doit comporter au moins 12 caractères.');
  const [row] = await db.q(
    `insert into admins (email, password_hash, role) values (lower($1), $2, $3)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role returning id`,
    [email, await hashPassword(password), role],
  );
  return row.id as string;
}

export async function loginAdmin(db: Database, email: string, password: string) {
  const row = await db.one('select id, password_hash from admins where email = lower($1)', [String(email ?? '')]);
  // Vérification factice si le compte n'existe pas, pour un temps de réponse constant.
  const ok = row ? await verifyPassword(String(password ?? ''), row.password_hash) : (await hashPassword('x'), false);
  if (!row || !ok) throw new HttpError(401, 'Identifiants incorrects.');
  const token = newToken('adm');
  await db.q(`insert into admin_sessions (token_hash, admin_id, expires_at) values ($1, $2, now() + interval '12 hours')`, [hashToken(token), row.id]);
  await db.q(`delete from admin_sessions where expires_at < now()`);
  return token;
}
