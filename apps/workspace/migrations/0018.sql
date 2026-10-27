ALTER TABLE contract_publications ADD COLUMN signing_policy_json TEXT CHECK(signing_policy_json IS NULL OR json_valid(signing_policy_json));
ALTER TABLE contract_publications ADD COLUMN signing_policy_hash TEXT CHECK(signing_policy_hash IS NULL OR length(signing_policy_hash)=64);
CREATE TABLE contract_signatures (
 id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL, contract_id TEXT NOT NULL,
 client_id TEXT NOT NULL, project_id TEXT, source_revision INTEGER NOT NULL, content_hash TEXT NOT NULL, policy_hash TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, signer_name TEXT NOT NULL, signed_at INTEGER NOT NULL,
 signature_hash TEXT NOT NULL, evidence_hash TEXT NOT NULL, evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
 object_key TEXT NOT NULL UNIQUE, document_sha256 TEXT NOT NULL CHECK(length(document_sha256)=64), document_size INTEGER NOT NULL CHECK(document_size>0),
 key_id TEXT NOT NULL, hmac TEXT NOT NULL, observed_ip TEXT NOT NULL, observed_user_agent TEXT NOT NULL,
 state_json TEXT NOT NULL CHECK(json_valid(state_json)), request_key TEXT NOT NULL CHECK(length(request_key)=36), request_fingerprint TEXT NOT NULL,
 UNIQUE(publication_id,organization_id), UNIQUE(contract_id,organization_id), UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE contract_signature_events (
 id TEXT PRIMARY KEY, signature_id TEXT NOT NULL, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 revision INTEGER NOT NULL, action TEXT NOT NULL CHECK(action='SIGN'), actor_id TEXT NOT NULL, actor_email TEXT NOT NULL,
 recorded_at INTEGER NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)), publication_state_json TEXT NOT NULL CHECK(json_valid(publication_state_json)),
 UNIQUE(publication_id,organization_id,revision),
 FOREIGN KEY(signature_id) REFERENCES contract_signatures(id),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id)
);
CREATE TABLE cancelled_contract_signature_requests (
 id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 request_key TEXT NOT NULL CHECK(length(request_key)=36), created_at INTEGER NOT NULL,
 UNIQUE(organization_id,actor_id,request_key),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
