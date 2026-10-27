CREATE TABLE invoice_drafts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT,
 created_by TEXT NOT NULL, title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 currency TEXT NOT NULL CHECK(currency IN ('CAD','USD','EUR','GBP')),
 origin TEXT NOT NULL DEFAULT 'WORKSPACE_DRAFT' CHECK(origin='WORKSPACE_DRAFT'),
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','VOID')),
 subtotal_minor INTEGER NOT NULL CHECK(typeof(subtotal_minor)='integer' AND subtotal_minor>=0 AND subtotal_minor<=9007199254740991),
 tax_minor INTEGER NOT NULL CHECK(typeof(tax_minor)='integer' AND tax_minor>=0 AND tax_minor<=9007199254740991),
 total_minor INTEGER NOT NULL CHECK(typeof(total_minor)='integer' AND total_minor>0 AND total_minor<=9007199254740991 AND total_minor=subtotal_minor+tax_minor),
 snapshot_json TEXT NOT NULL CHECK(length(snapshot_json)<=262144 AND json_valid(snapshot_json) AND json_extract(snapshot_json,'$.version')=1),
 request_key TEXT NOT NULL CHECK(length(request_key)=36),
 request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
 preview_fingerprint TEXT NOT NULL CHECK(length(preview_fingerprint)=64 AND preview_fingerprint NOT GLOB '*[^0-9a-f]*'),
 created_at INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 write_token TEXT NOT NULL UNIQUE,
 provider_state TEXT NOT NULL DEFAULT 'NOT_CONNECTED' CHECK(provider_state IN ('NOT_CONNECTED','PENDING','UNKNOWN','DRAFT','OPEN','PAID','VOID')),
 stripe_invoice_id TEXT, paid_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(paid_minor)='integer' AND paid_minor BETWEEN 0 AND total_minor),
 voided_at INTEGER, void_reason TEXT, released_at INTEGER,
 CHECK((status='DRAFT' AND voided_at IS NULL AND void_reason IS NULL) OR (status='VOID' AND voided_at IS NOT NULL AND length(void_reason) BETWEEN 1 AND 2000)),
 CHECK(released_at IS NULL OR status='VOID'),
 UNIQUE(id,organization_id), UNIQUE(organization_id,request_key),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX invoice_draft_scope ON invoice_drafts(organization_id,client_id,status,id);
CREATE TABLE invoice_events (
 id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('CREATE','VOID','RELEASE')), state_json TEXT NOT NULL CHECK(json_valid(state_json)),
 expected_count INTEGER NOT NULL, actual_count INTEGER NOT NULL CHECK(actual_count=expected_count),
 expected_history_count INTEGER NOT NULL, actual_history_count INTEGER NOT NULL CHECK(actual_history_count=expected_history_count),
 UNIQUE(invoice_id,organization_id,revision),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX invoice_event_scope ON invoice_events(organization_id,invoice_id,revision DESC);
CREATE TABLE time_billing_events (
 id TEXT PRIMARY KEY, time_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 owner_actor_id TEXT NOT NULL, actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('CLAIM','RELEASE')),
 revision INTEGER NOT NULL, source_kind TEXT, description TEXT NOT NULL, worked_on TEXT, billable INTEGER,
 currency TEXT, rate_minor INTEGER, rate_reference TEXT, review_status TEXT NOT NULL,
 reviewed_by TEXT, reviewed_at INTEGER, rejection_reason TEXT, invoice_ref TEXT, created_at INTEGER,
 started_at INTEGER NOT NULL, ended_at INTEGER, seconds INTEGER NOT NULL, invoice_id TEXT NOT NULL,
 UNIQUE(time_id,organization_id,revision),
 FOREIGN KEY(time_id,organization_id,project_id,owner_actor_id) REFERENCES time_details(id,organization_id,project_id,actor_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id)
);
CREATE INDEX time_billing_event_scope ON time_billing_events(organization_id,time_id,revision DESC);
