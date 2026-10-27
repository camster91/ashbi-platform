CREATE TABLE stripe_part_operations (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT NOT NULL, part_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('DEPOSIT','BALANCE')), mapping_id TEXT NOT NULL, account_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), request_key TEXT NOT NULL CHECK(length(request_key)=36), request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(plan_json)<=262144), plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
 activation_at INTEGER NOT NULL CHECK(typeof(activation_at)='integer' AND activation_at>=0),
 state TEXT NOT NULL CHECK(state IN ('PENDING','UNKNOWN','REVIEW_REQUIRED','DONE')), stage TEXT NOT NULL CHECK(stage IN ('CREATE','LINES','DONE')),
 stripe_invoice_id TEXT, create_attempt_at INTEGER CHECK(create_attempt_at IS NULL OR (typeof(create_attempt_at)='integer' AND create_attempt_at>=0)),
 lines_attempt_at INTEGER CHECK(lines_attempt_at IS NULL OR (typeof(lines_attempt_at)='integer' AND lines_attempt_at>=0)), last_error TEXT,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0 CHECK(typeof(lease_until)='integer' AND lease_until>=0), write_token TEXT NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(organization_id,part_id), UNIQUE(organization_id,request_key), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id),
 FOREIGN KEY(part_id,organization_id) REFERENCES stripe_installment_parts(id,organization_id), FOREIGN KEY(mapping_id,organization_id) REFERENCES stripe_customer_links(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 CHECK((stage='CREATE' AND stripe_invoice_id IS NULL AND lines_attempt_at IS NULL) OR (stage='LINES' AND stripe_invoice_id IS NOT NULL) OR (stage='DONE' AND state='DONE' AND stripe_invoice_id IS NOT NULL)),
 CHECK(state!='DONE' OR stage='DONE')
);
CREATE INDEX stripe_part_operation_scope ON stripe_part_operations(organization_id,invoice_id,schedule_id);
CREATE TABLE stripe_part_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, schedule_id TEXT NOT NULL, part_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 action TEXT NOT NULL CHECK(action IN ('PREPARE','ATTEMPT_CREATE','CREATED','ATTEMPT_LINES','COMPLETE','UNCERTAIN','REVIEW_REQUIRED','ADOPT')),
 reason TEXT, state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=65536),
 UNIQUE(operation_id,organization_id,revision), FOREIGN KEY(operation_id,organization_id) REFERENCES stripe_part_operations(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id),
 FOREIGN KEY(part_id,organization_id) REFERENCES stripe_installment_parts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX stripe_part_event_scope ON stripe_part_events(organization_id,schedule_id,operation_id,revision);
CREATE TABLE cancelled_stripe_part_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, part_id TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36), actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(part_id,organization_id) REFERENCES stripe_installment_parts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
