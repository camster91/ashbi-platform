CREATE TABLE commercial_drafts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('PROPOSAL','TEMPLATE','CONTRACT')),
 client_id TEXT, project_id TEXT,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 status TEXT NOT NULL CHECK(status IN ('DRAFT','ARCHIVED')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=262144),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 write_token TEXT NOT NULL UNIQUE,
 CHECK((kind='TEMPLATE' AND client_id IS NULL AND project_id IS NULL) OR (kind IN ('PROPOSAL','CONTRACT') AND client_id IS NOT NULL)),
 UNIQUE(id,organization_id),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
CREATE INDEX commercial_scope ON commercial_drafts(organization_id,kind,status,client_id,id);
CREATE TABLE commercial_versions (
 id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('CREATE','EDIT','ARCHIVE','REOPEN')),
 reason TEXT, state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=262144),
 request_key TEXT NOT NULL CHECK(length(request_key)=36),
 request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
 UNIQUE(draft_id,organization_id,revision), UNIQUE(organization_id,request_key),
 FOREIGN KEY(draft_id,organization_id) REFERENCES commercial_drafts(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX commercial_history ON commercial_versions(organization_id,draft_id,revision DESC);
