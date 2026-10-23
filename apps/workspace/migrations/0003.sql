CREATE TABLE files (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES actors(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180),
 object_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 5242880),
 sha256 TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
CREATE INDEX files_org_id ON files(organization_id,id);
