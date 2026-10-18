-- CUTLY v9 : liens privés de connexion administrateur (hachés, expirants, révocables).
CREATE TABLE IF NOT EXISTS admin_login_links (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 last_used_at TEXT,
 uses INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS admin_login_links_user_idx ON admin_login_links(user_id);

INSERT INTO schema_migrations(version,name,applied_at)
VALUES (9,'admin-login-links',to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT(version) DO NOTHING;
