ALTER TABLE time_entries ADD COLUMN write_token TEXT;
CREATE UNIQUE INDEX time_write_token ON time_entries(write_token) WHERE write_token IS NOT NULL;
CREATE UNIQUE INDEX time_entry_identity ON time_entries(id,organization_id,project_id,actor_id);
CREATE TABLE actor_finance_access (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
 FOREIGN KEY(id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE time_details (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 source_kind TEXT CHECK(source_kind IS NULL OR source_kind IN ('TIMER','MANUAL')),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 worked_on TEXT CHECK(worked_on IS NULL OR (length(worked_on)=10 AND worked_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
 billable INTEGER CHECK(billable IS NULL OR billable IN (0,1)),
 currency TEXT CHECK(currency IS NULL OR currency IN ('CAD','USD','EUR','GBP')),
 rate_minor INTEGER CHECK(rate_minor IS NULL OR (typeof(rate_minor)='integer' AND rate_minor>=0 AND rate_minor<=9007199254740991)),
 rate_reference TEXT CHECK(rate_reference IS NULL OR length(rate_reference) BETWEEN 1 AND 200),
 review_status TEXT NOT NULL DEFAULT 'PENDING' CHECK(review_status IN ('PENDING','APPROVED','REJECTED')),
 reviewed_by TEXT, reviewed_at INTEGER, rejection_reason TEXT,
 invoice_ref TEXT CHECK(invoice_ref IS NULL OR length(invoice_ref) BETWEEN 1 AND 200),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0 AND revision<=9007199254740991),
 created_at INTEGER, audit_token TEXT UNIQUE,
 UNIQUE(id,organization_id), UNIQUE(id,organization_id,project_id,actor_id),
 CHECK((currency IS NULL)=(rate_minor IS NULL)), CHECK(rate_reference IS NULL OR rate_minor IS NOT NULL),
 CHECK((review_status='PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL) OR
       (review_status='APPROVED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL AND worked_on IS NOT NULL AND billable IS NOT NULL AND (billable=0 OR currency IS NOT NULL)) OR
       (review_status='REJECTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND length(rejection_reason) BETWEEN 1 AND 2000)),
 FOREIGN KEY(id,organization_id,project_id,actor_id) REFERENCES time_entries(id,organization_id,project_id,actor_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(reviewed_by,organization_id) REFERENCES actors(id,organization_id)
);
INSERT INTO time_details(id,organization_id,project_id,actor_id) SELECT id,organization_id,project_id,actor_id FROM time_entries;
CREATE INDEX time_detail_scope ON time_details(organization_id,actor_id,review_status,project_id,id);
CREATE TABLE time_detail_events (
 id TEXT PRIMARY KEY, time_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 owner_actor_id TEXT NOT NULL, actor_id TEXT, recorded_at INTEGER,
 action TEXT NOT NULL CHECK(action IN ('BASELINE','CREATE','STOP','EDIT','APPROVE','REJECT','CLAIM')),
 revision INTEGER NOT NULL, source_kind TEXT, description TEXT NOT NULL, worked_on TEXT, billable INTEGER,
 currency TEXT, rate_minor INTEGER, rate_reference TEXT, review_status TEXT NOT NULL,
 reviewed_by TEXT, reviewed_at INTEGER, rejection_reason TEXT, invoice_ref TEXT, created_at INTEGER,
 started_at INTEGER NOT NULL, ended_at INTEGER, seconds INTEGER NOT NULL,
 UNIQUE(time_id,organization_id,revision),
 CHECK((action='BASELINE' AND actor_id IS NULL AND recorded_at IS NULL) OR (action!='BASELINE' AND actor_id IS NOT NULL AND recorded_at IS NOT NULL)),
 FOREIGN KEY(time_id,organization_id,project_id,owner_actor_id) REFERENCES time_details(id,organization_id,project_id,actor_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX time_event_scope ON time_detail_events(organization_id,time_id,revision DESC);
INSERT INTO time_detail_events(id,time_id,organization_id,project_id,owner_actor_id,actor_id,recorded_at,action,revision,source_kind,description,worked_on,billable,currency,rate_minor,rate_reference,review_status,reviewed_by,reviewed_at,rejection_reason,invoice_ref,created_at,started_at,ended_at,seconds)
 SELECT 'baseline:'||d.id,d.id,d.organization_id,d.project_id,d.actor_id,NULL,NULL,'BASELINE',d.revision,d.source_kind,d.description,d.worked_on,d.billable,d.currency,d.rate_minor,d.rate_reference,d.review_status,d.reviewed_by,d.reviewed_at,d.rejection_reason,d.invoice_ref,d.created_at,t.started_at,t.ended_at,t.seconds
 FROM time_details d JOIN time_entries t ON t.id=d.id AND t.organization_id=d.organization_id;
