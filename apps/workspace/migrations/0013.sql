CREATE TABLE proposal_reviews (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, proposal_id TEXT NOT NULL,
 client_id TEXT NOT NULL, project_id TEXT, source_revision INTEGER NOT NULL,
 source_hash TEXT NOT NULL CHECK(length(source_hash)=64), content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND length(snapshot_json)<=262144),
 round_number INTEGER NOT NULL CHECK(typeof(round_number)='integer' AND round_number>0),
 status TEXT NOT NULL CHECK(status IN ('OPEN','APPROVED','DECLINED','CHANGES_REQUESTED','SUPERSEDED')),
 expires_at INTEGER NOT NULL CHECK(typeof(expires_at)='integer' AND expires_at>0 AND expires_at%1000=0),
 created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 revision INTEGER NOT NULL CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 write_token TEXT NOT NULL UNIQUE, superseded_by TEXT,
 revoked_at INTEGER, revoked_by TEXT, revocation_reason TEXT,
 decision_actor_id TEXT, decision_actor_email TEXT, decision_at INTEGER, decision_comment TEXT,
 decision_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK(decision_acknowledged IN (0,1)),
 CHECK((status IN ('OPEN','SUPERSEDED') AND decision_actor_id IS NULL AND decision_actor_email IS NULL AND decision_at IS NULL AND decision_comment IS NULL AND decision_acknowledged=0) OR (status IN ('APPROVED','DECLINED','CHANGES_REQUESTED') AND decision_actor_id IS NOT NULL AND decision_actor_email IS NOT NULL AND decision_at IS NOT NULL AND decision_comment IS NOT NULL AND decision_acknowledged=1)),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(revocation_reason) BETWEEN 1 AND 2000)),
 UNIQUE(id,organization_id), UNIQUE(organization_id,proposal_id,round_number),
 FOREIGN KEY(proposal_id,organization_id,source_revision) REFERENCES commercial_versions(draft_id,organization_id,revision),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(created_by,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(decision_actor_id,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(revoked_by,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(superseded_by,organization_id) REFERENCES proposal_reviews(id,organization_id)
);
CREATE INDEX proposal_review_scope ON proposal_reviews(organization_id,client_id,project_id,id);
CREATE INDEX proposal_review_pending ON proposal_reviews(organization_id,proposal_id,status,revoked_at);
CREATE TABLE proposal_review_events (
 id TEXT PRIMARY KEY, review_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('PUBLISH','SUPERSEDE','APPROVE','DECLINE','REQUEST_CHANGES','REVOKE')),
 reason TEXT, state_json TEXT NOT NULL CHECK(json_valid(state_json) AND length(state_json)<=262144),
 request_scope TEXT, request_key TEXT, request_fingerprint TEXT, causation_id TEXT,
 CHECK((request_scope IS NULL AND request_key IS NULL AND request_fingerprint IS NULL) OR (request_scope IS NOT NULL AND length(request_key)=36 AND length(request_fingerprint)=64)),
 UNIQUE(review_id,organization_id,revision), UNIQUE(organization_id,request_scope,request_key),
 FOREIGN KEY(review_id,organization_id) REFERENCES proposal_reviews(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX proposal_review_history ON proposal_review_events(organization_id,review_id,revision DESC);
CREATE TABLE cancelled_proposal_review_requests (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, request_scope TEXT NOT NULL, request_key TEXT NOT NULL CHECK(length(request_key)=36),
 actor_id TEXT NOT NULL, review_id TEXT, created_at INTEGER NOT NULL,
 UNIQUE(organization_id,request_scope,request_key),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 FOREIGN KEY(review_id,organization_id) REFERENCES proposal_reviews(id,organization_id)
);
