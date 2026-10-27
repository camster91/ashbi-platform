CREATE TABLE stripe_part_projection (
 part_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT NOT NULL,
 creation_operation_id TEXT NOT NULL, issuance_operation_id TEXT NOT NULL, account_id TEXT NOT NULL, stripe_invoice_id TEXT NOT NULL,
 snapshot_json TEXT CHECK(snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(snapshot_json)<=262144)), snapshot_hash TEXT,
 observed_at INTEGER, revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 last_error TEXT, last_attempt_at INTEGER, lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(lease_until)='integer' AND lease_until>=0), write_token TEXT NOT NULL DEFAULT '',
 UNIQUE(part_id,organization_id), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(part_id,organization_id) REFERENCES stripe_installment_parts(id,organization_id), FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id), FOREIGN KEY(creation_operation_id,organization_id) REFERENCES stripe_part_operations(id,organization_id),
 FOREIGN KEY(issuance_operation_id,organization_id) REFERENCES stripe_part_issuance_operations(id,organization_id),
 CHECK((snapshot_json IS NULL AND snapshot_hash IS NULL AND observed_at IS NULL AND revision=0) OR (snapshot_json IS NOT NULL AND length(snapshot_hash)=64 AND observed_at IS NOT NULL AND revision>0))
);
CREATE INDEX stripe_part_projection_scope ON stripe_part_projection(organization_id,invoice_id,part_id);
CREATE TABLE stripe_part_lifecycle_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT NOT NULL, part_id TEXT NOT NULL,
 account_id TEXT NOT NULL, inbox_id TEXT, actor_id TEXT, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 1 AND 9007199254740991),
 observed_at INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('STAFF','WEBHOOK','SCHEDULED')),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=262144), snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash)=64),
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=65536),
 UNIQUE(part_id,organization_id,revision), UNIQUE(inbox_id,part_id,organization_id),
 FOREIGN KEY(part_id,organization_id) REFERENCES stripe_part_projection(part_id,organization_id), FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id), FOREIGN KEY(inbox_id) REFERENCES stripe_event_inbox(id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX stripe_part_lifecycle_scope ON stripe_part_lifecycle_events(organization_id,part_id,revision);
