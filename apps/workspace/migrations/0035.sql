CREATE TABLE push_subscriptions (
 organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 endpoint TEXT NOT NULL,
 endpoint_hash TEXT NOT NULL,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 subscribed_since INTEGER NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count BETWEEN 0 AND 20),
 PRIMARY KEY(organization_id,actor_id,endpoint),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 CHECK(length(endpoint) BETWEEN 1 AND 2048),
 CHECK(length(p256dh) BETWEEN 16 AND 256),
 CHECK(length(auth) BETWEEN 16 AND 256)
);
CREATE INDEX push_subscriptions_actor ON push_subscriptions(organization_id,actor_id,updated_at DESC);
CREATE UNIQUE INDEX push_subscriptions_hash ON push_subscriptions(organization_id,actor_id,endpoint_hash);
CREATE UNIQUE INDEX push_subscriptions_endpoint ON push_subscriptions(endpoint);

CREATE TABLE push_delivery_events (
 organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 endpoint TEXT NOT NULL,
 event_key TEXT NOT NULL,
 subscription_p256dh TEXT NOT NULL,
 subscription_auth TEXT NOT NULL,
 subscription_since INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','retry','sent','gone','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 next_attempt_at INTEGER NOT NULL,
 lease_token TEXT,
 lease_until INTEGER,
 last_error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,actor_id,endpoint,event_key),
 FOREIGN KEY(organization_id,actor_id,endpoint) REFERENCES push_subscriptions(organization_id,actor_id,endpoint) ON DELETE CASCADE
);
CREATE INDEX push_delivery_due ON push_delivery_events(state,next_attempt_at,updated_at);
CREATE INDEX push_delivery_actor ON push_delivery_events(organization_id,actor_id,event_key);

CREATE TABLE push_scan_state (
 name TEXT PRIMARY KEY,
 actor_cursor TEXT NOT NULL DEFAULT '',
 updated_at INTEGER NOT NULL
);
