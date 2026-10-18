-- CUTLY v8 : suivi des notifications (clé anti-doublon, événements du fournisseur, adresses en rebond).
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS dedupe_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS outbox_dedupe_uq ON notification_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS outbox_provider_msg_idx ON notification_outbox(provider_message_id);

CREATE TABLE IF NOT EXISTS notification_events (
 id TEXT PRIMARY KEY,
 outbox_id TEXT REFERENCES notification_outbox(id),
 provider_event_id TEXT NOT NULL UNIQUE,
 provider_message_id TEXT,
 type TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 detail TEXT
);
CREATE INDEX IF NOT EXISTS notification_events_outbox_idx ON notification_events(outbox_id);

CREATE TABLE IF NOT EXISTS email_suppressions (
 email TEXT PRIMARY KEY,
 reason TEXT NOT NULL,
 created_at TEXT NOT NULL
);

INSERT INTO schema_migrations(version,name,applied_at)
VALUES (8,'notification-tracking',to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT(version) DO NOTHING;
