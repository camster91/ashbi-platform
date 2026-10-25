ALTER TABLE time_details ADD COLUMN request_key TEXT;
ALTER TABLE time_details ADD COLUMN request_fingerprint TEXT CHECK(
 (request_key IS NULL AND request_fingerprint IS NULL) OR
 (request_key IS NOT NULL AND length(request_key)=36 AND request_fingerprint IS NOT NULL AND length(request_fingerprint)=64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*')
);
CREATE UNIQUE INDEX time_manual_request ON time_details(organization_id,actor_id,request_key) WHERE request_key IS NOT NULL;
