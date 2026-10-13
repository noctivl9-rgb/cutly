-- CUTLY PostgreSQL schema. Values representing instants remain normalized UTC ISO-8601 text
-- to preserve the exact shape already used by SQLite and the HTTP API.
CREATE TABLE IF NOT EXISTS schema_migrations (
 version INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS establishments (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 address TEXT NOT NULL,
 phone TEXT NOT NULL,
 instagram TEXT NOT NULL,
 description TEXT NOT NULL,
 timezone TEXT NOT NULL DEFAULT 'Europe/Paris'
);

CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 email TEXT NOT NULL,
 phone TEXT UNIQUE,
 first_name TEXT NOT NULL,
 last_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 email_verified_at TEXT,
 phone_verified_at TEXT,
 preferred_language TEXT NOT NULL DEFAULT 'fr',
 role TEXT NOT NULL DEFAULT 'CLIENT' CHECK(role IN ('CLIENT','PROFESSIONAL','ESTABLISHMENT_ADMIN','PLATFORM_ADMIN')),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 disabled_at TEXT,
 version INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_nocase_uq ON users(lower(email));
CREATE INDEX IF NOT EXISTS users_email_idx ON users(email);

CREATE TABLE IF NOT EXISTS services (
 id TEXT PRIMARY KEY,
 establishment_id TEXT NOT NULL REFERENCES establishments(id),
 name TEXT NOT NULL,
 price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
 duration_minutes INTEGER NOT NULL CHECK(duration_minutes > 0),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 eligible INTEGER NOT NULL DEFAULT 1 CHECK(eligible IN (0,1)),
 version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS opening_hours (
 establishment_id TEXT NOT NULL REFERENCES establishments(id),
 weekday INTEGER NOT NULL,
 opens TEXT,
 closes TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(establishment_id,weekday)
);

CREATE TABLE IF NOT EXISTS appointments (
 id TEXT PRIMARY KEY,
 establishment_id TEXT NOT NULL REFERENCES establishments(id),
 service_id TEXT NOT NULL REFERENCES services(id),
 client_name TEXT NOT NULL,
 client_email TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 timezone TEXT NOT NULL,
 service_name_snapshot TEXT NOT NULL,
 price_cents_snapshot INTEGER NOT NULL,
 duration_minutes_snapshot INTEGER NOT NULL,
 loyalty_eligible_snapshot INTEGER NOT NULL DEFAULT 1 CHECK(loyalty_eligible_snapshot IN (0,1)),
 client_user_id TEXT REFERENCES users(id),
 reward_id TEXT,
 status TEXT NOT NULL CHECK(status IN ('PENDING','CONFIRMED','REJECTED','CANCELLED','COMPLETED','NO_SHOW')),
 payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK(payment_status IN ('UNPAID','PAID','NOT_APPLICABLE')),
 created_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
 id_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 user_agent TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_exp_idx ON sessions(user_id,expires_at);

CREATE TABLE IF NOT EXISTS admin_mfa (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 secret_encrypted TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 last_used_step INTEGER NOT NULL DEFAULT -1,
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_challenges (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('EMAIL','PHONE','PASSWORD_RESET')),
 destination TEXT NOT NULL,
 token_hash TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS establishment_members (
 user_id TEXT NOT NULL REFERENCES users(id),
 establishment_id TEXT NOT NULL REFERENCES establishments(id),
 role TEXT NOT NULL CHECK(role IN ('PROFESSIONAL','ESTABLISHMENT_ADMIN')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 PRIMARY KEY(user_id,establishment_id,role)
);

CREATE TABLE IF NOT EXISTS unavailability (
 id TEXT PRIMARY KEY,
 establishment_id TEXT NOT NULL REFERENCES establishments(id),
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 reason TEXT,
 created_by TEXT REFERENCES users(id),
 created_at TEXT NOT NULL,
 CHECK(ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS unavailability_time_idx ON unavailability(establishment_id,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS cancellation_requests (
 id TEXT PRIMARY KEY,
 appointment_id TEXT NOT NULL REFERENCES appointments(id),
 requested_by TEXT NOT NULL REFERENCES users(id),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED')),
 reason TEXT,
 created_at TEXT NOT NULL,
 resolved_at TEXT,
 resolved_by TEXT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_cancellation_per_appointment
 ON cancellation_requests(appointment_id) WHERE status='PENDING';

CREATE TABLE IF NOT EXISTS payment_events (
 id TEXT PRIMARY KEY,
 appointment_id TEXT NOT NULL REFERENCES appointments(id),
 status TEXT NOT NULL CHECK(status IN ('PAID','CORRECTION','NOT_APPLICABLE')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
 method TEXT,
 actor_id TEXT REFERENCES users(id),
 reason TEXT,
 correction_of TEXT REFERENCES payment_events(id),
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_paid_event_per_appointment
 ON payment_events(appointment_id) WHERE status='PAID';

CREATE TABLE IF NOT EXISTS rewards (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 cycle_number INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','USED','REVIEW_NO_SHOW','CANCELLED')),
 earned_at TEXT NOT NULL,
 used_appointment_id TEXT REFERENCES appointments(id),
 used_at TEXT,
 UNIQUE(user_id,cycle_number)
);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='appointments_reward_id_fkey') THEN
  ALTER TABLE appointments ADD CONSTRAINT appointments_reward_id_fkey
   FOREIGN KEY(reward_id) REFERENCES rewards(id);
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS loyalty_ledger (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 appointment_id TEXT REFERENCES appointments(id),
 kind TEXT NOT NULL CHECK(kind IN ('EARN','REDEEM','RESTORE','CORRECTION','REVIEW_NO_SHOW')),
 points INTEGER NOT NULL,
 cycle_number INTEGER NOT NULL DEFAULT 1,
 reward_id TEXT REFERENCES rewards(id),
 actor_id TEXT REFERENCES users(id),
 reason TEXT,
 reference_id TEXT REFERENCES loyalty_ledger(id),
 created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_earned_point_per_appointment
 ON loyalty_ledger(appointment_id) WHERE kind='EARN' AND appointment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS reviews (
 id TEXT PRIMARY KEY,
 appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 comment TEXT,
 status TEXT NOT NULL DEFAULT 'PENDING_MODERATION' CHECK(status IN ('PENDING_MODERATION','PUBLISHED','REPORTED','HIDDEN')),
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
 id TEXT PRIMARY KEY,
 actor_id TEXT REFERENCES users(id),
 establishment_id TEXT REFERENCES establishments(id),
 action TEXT NOT NULL,
 object_type TEXT NOT NULL,
 object_id TEXT NOT NULL,
 before_json TEXT,
 after_json TEXT,
 reason TEXT,
 result TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_object_idx ON audit_events(object_type,object_id,created_at);

CREATE TABLE IF NOT EXISTS notification_outbox (
 id TEXT PRIMARY KEY,
 appointment_id TEXT REFERENCES appointments(id),
 channel TEXT NOT NULL,
 kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENT','FAILED','RETRYING','OBSOLETE')),
 payload_json TEXT NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT,
 sent_at TEXT,
 last_error TEXT,
 created_at TEXT NOT NULL,
 provider_name TEXT,
 provider_message_id TEXT,
 provider_status TEXT,
 UNIQUE(appointment_id,channel,kind)
);
CREATE INDEX IF NOT EXISTS outbox_delivery_idx ON notification_outbox(status,next_attempt_at);

CREATE TABLE IF NOT EXISTS rate_limits (
 key_hash TEXT PRIMARY KEY,
 attempts INTEGER NOT NULL,
 expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_limits_expiry_idx ON rate_limits(expires_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
 key TEXT PRIMARY KEY,
 scope TEXT NOT NULL,
 response_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS appointments_time_idx ON appointments(establishment_id,starts_at,ends_at,status);

-- Serialize at the database boundary and reject overlapping live appointments,
-- including writes that do not pass through the HTTP booking service.
CREATE OR REPLACE FUNCTION cutly_prevent_active_appointment_overlap()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status IN ('PENDING','CONFIRMED') THEN
  PERFORM pg_advisory_xact_lock(hashtext('appointment-space:' || NEW.establishment_id));
  IF EXISTS (
   SELECT 1 FROM appointments a
    WHERE a.establishment_id=NEW.establishment_id
      AND a.status IN ('PENDING','CONFIRMED')
      AND a.starts_at<NEW.ends_at AND a.ends_at>NEW.starts_at
      AND a.id<>NEW.id
  ) THEN
   RAISE EXCEPTION 'appointment_overlap' USING ERRCODE='23P01';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='prevent_active_appointment_overlap' AND NOT tgisinternal) THEN
  CREATE TRIGGER prevent_active_appointment_overlap
   BEFORE INSERT OR UPDATE OF starts_at,ends_at,status,establishment_id ON appointments
   FOR EACH ROW EXECUTE FUNCTION cutly_prevent_active_appointment_overlap();
 END IF;
END $$;

INSERT INTO schema_migrations(version,name,applied_at)
SELECT version,name,to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
FROM (VALUES
 (1,'initial-domain-schema'),
 (2,'booking-and-loyalty-snapshots'),
 (3,'appointment-reward-link'),
 (4,'version-opening-hours'),
 (5,'version-users'),
 (6,'notification-provider-receipts'),
 (7,'shared-rate-limits')
) AS migrations(version,name)
ON CONFLICT(version) DO NOTHING;
