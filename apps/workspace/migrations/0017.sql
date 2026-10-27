CREATE TABLE contract_publications (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, contract_id TEXT NOT NULL,
 client_id TEXT NOT NULL, project_id TEXT, source_revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=262144),
 status TEXT NOT NULL CHECK(status IN ('PENDING','WITHDRAWN')),
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL, write_token TEXT NOT NULL UNIQUE,
 withdrawn_at INTEGER, withdrawn_by TEXT, withdrawal_reason TEXT,
 CHECK((status='PENDING' AND withdrawn_at IS NULL AND withdrawn_by IS NULL AND withdrawal_reason IS NULL) OR (status='WITHDRAWN' AND withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND length(withdrawal_reason) BETWEEN 1 AND 2000)),
 UNIQUE(id,organization_id),
 FOREIGN KEY(contract_id,organization_id,source_revision) REFERENCES commercial_versions(draft_id,organization_id,revision),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(withdrawn_by,organization_id) REFERENCES actors(id,organization_id)
);
CREATE UNIQUE INDEX contract_publication_pending ON contract_publications(organization_id,contract_id) WHERE status='PENDING';
CREATE INDEX contract_publication_scope ON contract_publications(organization_id,client_id,project_id,id);
CREATE TABLE contract_publication_events (
 id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, recorded_at INTEGER NOT NULL, revision INTEGER NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('PUBLISH','WITHDRAW')), reason TEXT NOT NULL,
 state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=262144),
 request_key TEXT NOT NULL CHECK(length(request_key)=36), request_fingerprint TEXT NOT NULL CHECK(length(request_fingerprint)=64),
 UNIQUE(publication_id,organization_id,revision), UNIQUE(organization_id,request_key),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX contract_publication_history ON contract_publication_events(organization_id,publication_id,revision DESC);
CREATE TABLE cancelled_contract_publication_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36),
 actor_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(organization_id,request_key),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
