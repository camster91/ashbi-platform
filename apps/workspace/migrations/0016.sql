CREATE TABLE stripe_event_inbox (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, account_id TEXT NOT NULL, event_id TEXT NOT NULL,
 event_type TEXT NOT NULL, target_kind TEXT NOT NULL, target_id TEXT NOT NULL, content_hash TEXT NOT NULL,
 api_version TEXT, stripe_created_at INTEGER NOT NULL, received_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 invoice_id TEXT, state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSING','RETRY','REVIEW_REQUIRED','APPLIED','IGNORED')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
 UNIQUE(account_id,event_id), UNIQUE(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id)
);
CREATE INDEX stripe_inbox_drain ON stripe_event_inbox(organization_id,account_id,state,next_attempt_at,lease_until);
CREATE TABLE stripe_invoice_projection (
 invoice_id TEXT NOT NULL, organization_id TEXT NOT NULL, operation_id TEXT NOT NULL, account_id TEXT NOT NULL,
 stripe_invoice_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, snapshot_json TEXT CHECK(snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(snapshot_json)<=262144)),
 observed_at INTEGER, last_error TEXT, last_attempt_at INTEGER, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, write_token TEXT NOT NULL DEFAULT 'initial',
 PRIMARY KEY(invoice_id,organization_id), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(operation_id,organization_id) REFERENCES stripe_invoice_operations(id,organization_id)
);
CREATE TABLE stripe_lifecycle_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, account_id TEXT NOT NULL,
 inbox_id TEXT, actor_id TEXT, revision INTEGER NOT NULL, observed_at INTEGER NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('WEBHOOK','SCHEDULED','STAFF')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
 UNIQUE(invoice_id,organization_id,revision), UNIQUE(inbox_id,invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(inbox_id,organization_id) REFERENCES stripe_event_inbox(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX stripe_projection_scope ON stripe_invoice_projection(organization_id,invoice_id);
CREATE INDEX stripe_lifecycle_scope ON stripe_lifecycle_events(organization_id,invoice_id,revision DESC);
