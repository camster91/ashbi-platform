CREATE TABLE stripe_customer_links (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL, account_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 client_revision INTEGER NOT NULL, customer_json TEXT NOT NULL CHECK(json_valid(customer_json)),
 request_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, actor_id TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000), created_at INTEGER NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(organization_id,client_id,account_id), UNIQUE(account_id,customer_id), UNIQUE(organization_id,request_key),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE stripe_invoice_operations (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, mapping_id TEXT NOT NULL,
 account_id TEXT NOT NULL, customer_id TEXT NOT NULL, actor_id TEXT NOT NULL, reason TEXT NOT NULL,
 request_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL, plan_json TEXT NOT NULL CHECK(json_valid(plan_json)),
 state TEXT NOT NULL CHECK(state IN ('PENDING','UNKNOWN','REVIEW_REQUIRED','DONE')),
 stage TEXT NOT NULL CHECK(stage IN ('CREATE','LINES','DONE')), stripe_invoice_id TEXT,
 create_attempt_at INTEGER, lines_attempt_at INTEGER, last_error TEXT,
 revision INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0, write_token TEXT NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(organization_id,invoice_id), UNIQUE(organization_id,request_key), UNIQUE(account_id,stripe_invoice_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(mapping_id,organization_id) REFERENCES stripe_customer_links(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE stripe_invoice_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, operation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('PREPARE','ATTEMPT_CREATE','CREATED','ATTEMPT_LINES','COMPLETE','UNCERTAIN','REVIEW_REQUIRED','ADOPT')),
 state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 UNIQUE(operation_id,organization_id,revision),
 FOREIGN KEY(operation_id,organization_id) REFERENCES stripe_invoice_operations(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX stripe_operation_scope ON stripe_invoice_operations(organization_id,invoice_id);
CREATE INDEX stripe_event_scope ON stripe_invoice_events(organization_id,invoice_id,revision DESC);
