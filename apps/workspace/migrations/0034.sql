ALTER TABLE notification_preferences ADD COLUMN email INTEGER NOT NULL DEFAULT 0 CHECK(email IN(0,1));
ALTER TABLE notification_preferences ADD COLUMN email_enabled_since INTEGER;

CREATE TABLE notification_email_deliveries (
 organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('message','assignment','deadline','upload')),
 item_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','RETRY','ACCEPTED','FAILED','DISABLED','UNCERTAIN')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=10),
 next_attempt_at INTEGER NOT NULL,
 lease_until INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,
 last_attempt_at INTEGER,
 recipient_email TEXT NOT NULL,
 sender TEXT NOT NULL,
 payload_fingerprint TEXT NOT NULL,
 provider_id TEXT,
 error_code TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,actor_id,kind,item_id),
 UNIQUE(organization_id,actor_id,idempotency_key),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX notification_email_due ON notification_email_deliveries(status,next_attempt_at,lease_until,organization_id);
CREATE INDEX notification_email_actor ON notification_email_deliveries(organization_id,actor_id,updated_at DESC);

CREATE TABLE notification_email_scheduler (
 id INTEGER PRIMARY KEY CHECK(id=1),
 organization_id TEXT,
 actor_id TEXT,
 updated_at INTEGER NOT NULL
);
