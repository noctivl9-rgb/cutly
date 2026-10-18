// Lien privé de connexion administrateur : un secret aléatoire de 256 bits dans l'adresse, valable 24 h, réutilisable pendant
// cette durée, révocable. Seul le haché (HMAC avec la clé de chiffrement du site) est stocké : la base ne permet pas de reconstituer le lien.
// Il remplace le mot de passe et le code à 6 chiffres : il doit être protégé comme un mot de passe.
// Il ne peut être CRÉÉ que par quelqu'un qui a l'accès à la base de données (scripts/admin-link-netlify.js).
const crypto = require('node:crypto');
const { withTransaction } = require('./database');

const DEFAULT_TTL_HOURS = 24;
const digest = (token, key) => crypto.createHmac('sha256', key).update(`admin-link:${token}`).digest('hex');

// Crée un lien pour l'administrateur : les liens précédents sont révoqués (un seul lien actif à la fois).
async function createAdminLink(db, { email, key, ttlHours = DEFAULT_TTL_HOURS, now = new Date() }) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Clé de chiffrement invalide.');
  if (!(ttlHours > 0 && ttlHours <= 72)) throw new Error('Durée invalide (72 h maximum).');
  const token = crypto.randomBytes(32).toString('base64url'), timestamp = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlHours * 3600000).toISOString();
  await withTransaction(db, async tx => {
    const user = await tx.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND role='ESTABLISHMENT_ADMIN' AND disabled_at IS NULL").get(String(email).trim());
    if (!user) throw new Error('Aucun administrateur actif avec cet e-mail.');
    await tx.prepare('UPDATE admin_login_links SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(timestamp, user.id);
    await tx.prepare('INSERT INTO admin_login_links(id,user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(crypto.randomUUID(), user.id, digest(token, key), timestamp, expiresAt);
    await tx.prepare("INSERT INTO audit_events(id,actor_id,action,object_type,object_id,result,created_at) VALUES(?,?,'ADMIN_LINK_CREATED','USER',?,'SUCCESS',?)").run(crypto.randomUUID(), user.id, user.id, timestamp);
  });
  return { token, expiresAt };
}

// Vérifie un lien. Renvoie l'identifiant de l'administrateur, ou null (inconnu, expiré, révoqué, compte désactivé).
async function consumeAdminLink(db, { token, key, now = new Date() }) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100 || !Buffer.isBuffer(key) || key.length !== 32) return null;
  const timestamp = now.toISOString();
  return withTransaction(db, async tx => {
    const link = await tx.prepare("SELECT l.id,l.user_id FROM admin_login_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=? AND l.revoked_at IS NULL AND l.expires_at>? AND u.role='ESTABLISHMENT_ADMIN' AND u.disabled_at IS NULL").get(digest(token, key), timestamp);
    if (!link) return null;
    await tx.prepare('UPDATE admin_login_links SET uses=uses+1,last_used_at=? WHERE id=?').run(timestamp, link.id);
    await tx.prepare("INSERT INTO audit_events(id,actor_id,action,object_type,object_id,result,created_at) VALUES(?,?,'ADMIN_LINK_LOGIN','USER',?,'SUCCESS',?)").run(crypto.randomUUID(), link.user_id, link.user_id, timestamp);
    return link.user_id;
  });
}

async function revokeAdminLinks(db, { email, now = new Date() }) {
  const user = await db.prepare("SELECT id FROM users WHERE lower(email)=lower(?) AND role='ESTABLISHMENT_ADMIN'").get(String(email).trim());
  if (!user) return 0;
  return (await db.prepare('UPDATE admin_login_links SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL').run(now.toISOString(), user.id)).changes;
}

// Liens permanents (un par personne : « moi », « associe »…) : seule l'empreinte SHA-256 du secret est stockée,
// dans la variable d'environnement CUTLY_ADMIN_LINKS (« nom:empreinte,nom:empreinte »). Retirer une entrée désactive ce lien.
function standingAdminLink(token, config = process.env.CUTLY_ADMIN_LINKS || '') {
  if (typeof token !== 'string' || token.length < 40 || token.length > 100) return null;
  const digest = Buffer.from(crypto.createHash('sha256').update(token).digest('hex'));
  for (const entry of config.split(',')) {
    const [label, hash] = entry.trim().split(':');
    if (!label || !/^[a-f0-9]{64}$/.test(hash || '')) continue;
    if (crypto.timingSafeEqual(Buffer.from(hash), digest)) return label;
  }
  return null;
}

module.exports = { createAdminLink, consumeAdminLink, revokeAdminLinks, standingAdminLink, DEFAULT_TTL_HOURS };
