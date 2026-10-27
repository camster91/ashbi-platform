CREATE TABLE source_pilot_runs (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL, project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64),
 image_sha256 TEXT NOT NULL CHECK(length(image_sha256)=64), report_json TEXT NOT NULL,
 client_revision INTEGER NOT NULL, project_revision INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN('PENDING','DONE')),
 created_at INTEGER NOT NULL, completed_at INTEGER, write_token TEXT,
 fence INTEGER NOT NULL DEFAULT 1 CHECK(fence=1),
 UNIQUE(id,organization_id,project_id), UNIQUE(organization_id,project_id,fingerprint),
 FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id),
 CHECK((state='PENDING' AND completed_at IS NULL) OR (state='DONE' AND completed_at IS NOT NULL))
);
CREATE TABLE source_pilot_records (
 run_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 source_key TEXT NOT NULL, image_json TEXT NOT NULL, fence INTEGER NOT NULL DEFAULT 1 CHECK(fence=1),
 target_kind TEXT, target_id TEXT, initial_version_id TEXT,
 PRIMARY KEY(run_id,source_key), UNIQUE(organization_id,project_id,source_key),
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES source_pilot_runs(id,organization_id,project_id),
 CHECK(target_kind IS NULL OR target_kind IN('document','task','file','client','project'))
);
CREATE TABLE source_pilot_objects (
 run_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('notion','bonsai','legacy')), path TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 5242880),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), fence INTEGER NOT NULL DEFAULT 1 CHECK(fence=1),
 PRIMARY KEY(run_id,source,path),
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES source_pilot_runs(id,organization_id,project_id)
);
