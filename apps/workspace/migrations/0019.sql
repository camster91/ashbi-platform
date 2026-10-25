CREATE TABLE contract_signature_pdfs (
 id TEXT PRIMARY KEY, signature_id TEXT NOT NULL, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 evidence_hash TEXT NOT NULL CHECK(length(evidence_hash)=64), json_sha256 TEXT NOT NULL CHECK(length(json_sha256)=64),
 pdf_sha256 TEXT NOT NULL CHECK(length(pdf_sha256)=64), pdf_size INTEGER NOT NULL CHECK(pdf_size>0 AND pdf_size<=16777216),
 object_key TEXT NOT NULL UNIQUE, renderer_version TEXT NOT NULL, font_version TEXT NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)), key_id TEXT NOT NULL, hmac TEXT NOT NULL CHECK(length(hmac)=64),
 created_at INTEGER NOT NULL,
 UNIQUE(id,organization_id), UNIQUE(signature_id,organization_id), UNIQUE(publication_id,organization_id),
 FOREIGN KEY(signature_id) REFERENCES contract_signatures(id),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id)
);
CREATE TABLE contract_signature_pdf_events (
 id TEXT PRIMARY KEY, pdf_id TEXT NOT NULL, signature_id TEXT NOT NULL, publication_id TEXT NOT NULL, organization_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='CREATE'), actor_id TEXT NOT NULL, actor_email TEXT NOT NULL, recorded_at INTEGER NOT NULL,
 manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 UNIQUE(pdf_id,organization_id), UNIQUE(signature_id,organization_id),
 FOREIGN KEY(pdf_id,organization_id) REFERENCES contract_signature_pdfs(id,organization_id),
 FOREIGN KEY(signature_id) REFERENCES contract_signatures(id),
 FOREIGN KEY(publication_id,organization_id) REFERENCES contract_publications(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
