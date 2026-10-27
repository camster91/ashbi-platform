CREATE TABLE stripe_invoice_delivery_operations (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT, part_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('FULL','DEPOSIT','BALANCE')), creation_operation_id TEXT NOT NULL, issuance_operation_id TEXT NOT NULL,
 issuance_revision INTEGER NOT NULL CHECK(typeof(issuance_revision)='integer' AND issuance_revision>=0), account_id TEXT NOT NULL, customer_id TEXT NOT NULL, stripe_invoice_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 request_key TEXT NOT NULL CHECK(length(request_key)=36), request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(CAST(plan_json AS BLOB))<=524288), plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
 source_image_json TEXT NOT NULL CHECK(json_valid(source_image_json) AND length(CAST(source_image_json AS BLOB))<=1048576), source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 state TEXT NOT NULL CHECK(state IN ('PENDING','UNKNOWN','REVIEW_REQUIRED','DONE')), stage TEXT NOT NULL CHECK(stage IN ('SEND','DONE')),
 attempt_at INTEGER CHECK(attempt_at IS NULL OR (typeof(attempt_at)='integer' AND attempt_at>=0)), last_error TEXT,
 provider_acknowledged_at INTEGER, provider_request_id TEXT, matching_sent_event_observed_at INTEGER, matching_sent_event_id TEXT,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 1000), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, write_token TEXT NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(organization_id,request_key), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 CHECK((kind='FULL' AND schedule_id IS NULL AND part_id IS NULL) OR (kind!='FULL' AND schedule_id IS NOT NULL AND part_id IS NOT NULL)),
 CHECK((state='DONE')=(stage='DONE')), CHECK(state!='DONE' OR (attempt_at IS NOT NULL AND (provider_acknowledged_at IS NOT NULL OR matching_sent_event_observed_at IS NOT NULL))),
 CHECK((matching_sent_event_observed_at IS NULL)=(matching_sent_event_id IS NULL))
);
CREATE INDEX stripe_delivery_scope ON stripe_invoice_delivery_operations(organization_id,invoice_id,part_id);
CREATE TABLE stripe_invoice_delivery_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT, part_id TEXT, operation_id TEXT NOT NULL,
 actor_id TEXT, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 1000),
 action TEXT NOT NULL CHECK(action IN ('PREPARE','ATTEMPT_SEND','ACKNOWLEDGED','SENT_EVENT_OBSERVED','UNCERTAIN','REVIEW_REQUIRED')), reason TEXT,
 inbox_id TEXT, state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(CAST(state_json AS BLOB))<=65536),
 UNIQUE(operation_id,organization_id,revision), UNIQUE(operation_id,inbox_id),
 FOREIGN KEY(operation_id,organization_id) REFERENCES stripe_invoice_delivery_operations(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id), FOREIGN KEY(inbox_id,organization_id) REFERENCES stripe_event_inbox(id,organization_id)
);
CREATE INDEX stripe_delivery_event_scope ON stripe_invoice_delivery_events(organization_id,operation_id,revision);
CREATE TABLE cancelled_stripe_invoice_delivery_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, part_id TEXT, request_key TEXT NOT NULL CHECK(length(request_key)=36), actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
ALTER TABLE stripe_event_inbox ADD COLUMN send_evidence_json TEXT CHECK(send_evidence_json IS NULL OR (json_valid(send_evidence_json) AND length(CAST(send_evidence_json AS BLOB))<=16384));
