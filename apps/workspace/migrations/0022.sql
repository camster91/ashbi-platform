CREATE TABLE stripe_installment_schedules (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT,
 request_key TEXT NOT NULL CHECK(length(request_key)=36), request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(plan_json)<=524288), plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64),
 source_image_json TEXT NOT NULL CHECK(json_valid(source_image_json) AND length(source_image_json)<=524288), source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
 actor_id TEXT NOT NULL, reason TEXT NOT NULL CHECK(length(reason) BETWEEN 1 AND 2000),
 state TEXT NOT NULL CHECK(state IN ('FROZEN','ABANDONED')), revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 parent_revision INTEGER NOT NULL CHECK(typeof(parent_revision)='integer' AND parent_revision BETWEEN 0 AND 9007199254740991),
 activated_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, abandoned_at INTEGER, abandoned_by TEXT, abandonment_reason TEXT,
 write_token TEXT NOT NULL UNIQUE,
 UNIQUE(id,organization_id), UNIQUE(organization_id,request_key),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id), FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id), FOREIGN KEY(abandoned_by,organization_id) REFERENCES actors(id,organization_id),
 CHECK((state='FROZEN' AND revision=0 AND abandoned_at IS NULL AND abandoned_by IS NULL AND abandonment_reason IS NULL) OR (state='ABANDONED' AND revision=1 AND abandoned_at IS NOT NULL AND abandoned_by IS NOT NULL AND length(abandonment_reason) BETWEEN 1 AND 2000))
);
CREATE UNIQUE INDEX stripe_schedule_active ON stripe_installment_schedules(organization_id,invoice_id) WHERE state='FROZEN';
CREATE INDEX stripe_schedule_invoice ON stripe_installment_schedules(organization_id,invoice_id,parent_revision DESC);
CREATE TABLE stripe_installment_parts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, schedule_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('DEPOSIT','BALANCE')), ordinal INTEGER NOT NULL CHECK(ordinal IN (0,1)),
 plan_json TEXT NOT NULL CHECK(json_valid(plan_json) AND length(plan_json)<=262144), plan_hash TEXT NOT NULL CHECK(length(plan_hash)=64), created_at INTEGER NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(schedule_id,kind), UNIQUE(schedule_id,ordinal),
 FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id),
 CHECK(json_extract(plan_json,'$.kind') IS kind AND json_type(plan_json,'$.totalMinor') IS 'integer' AND json_extract(plan_json,'$.totalMinor') BETWEEN 1 AND 99999999 AND json_type(plan_json,'$.subtotalMinor') IS 'integer' AND json_extract(plan_json,'$.subtotalMinor')>=0 AND json_type(plan_json,'$.taxMinor') IS 'integer' AND json_extract(plan_json,'$.taxMinor')>=0 AND json_extract(plan_json,'$.subtotalMinor')+json_extract(plan_json,'$.taxMinor')=json_extract(plan_json,'$.totalMinor'))
);
CREATE TABLE stripe_installment_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, schedule_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision IN (0,1)), action TEXT NOT NULL CHECK(action IN ('FREEZE','ABANDON')),
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=1048576), recorded_at INTEGER NOT NULL,
 UNIQUE(schedule_id,organization_id,revision),
 FOREIGN KEY(schedule_id,organization_id) REFERENCES stripe_installment_schedules(id,organization_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE cancelled_stripe_schedule_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, invoice_id TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36), actor_id TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_key), FOREIGN KEY(invoice_id,organization_id) REFERENCES invoice_drafts(id,organization_id), FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
