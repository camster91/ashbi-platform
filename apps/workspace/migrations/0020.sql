CREATE TABLE stripe_invoice_issuance_operations (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, creation_operation_id TEXT NOT NULL,
 account_id TEXT NOT NULL, customer_id TEXT NOT NULL, stripe_invoice_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL,
 request_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 state TEXT NOT NULL CHECK(state IN ('PENDING','UNKNOWN','REVIEW_REQUIRED','DONE')), stage TEXT NOT NULL CHECK(stage IN ('FINALIZE','DONE')),
 attempt_at INTEGER, last_error TEXT, observation_pending INTEGER NOT NULL DEFAULT 1 CHECK(observation_pending IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, write_token TEXT NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(organization_id,invoice_id), UNIQUE(organization_id,request_key), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(creation_operation_id,organization_id) REFERENCES stripe_invoice_operations(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE stripe_invoice_issuance_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('PREPARE','ATTEMPT_FINALIZE','OBSERVED_FINALIZED','UNCERTAIN','REVIEW_REQUIRED','OBSERVATION_SAVED')),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)), UNIQUE(operation_id,organization_id,revision),
 FOREIGN KEY(operation_id,organization_id) REFERENCES stripe_invoice_issuance_operations(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE cancelled_stripe_invoice_issuance_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, request_key TEXT NOT NULL,
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(organization_id,request_key),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
