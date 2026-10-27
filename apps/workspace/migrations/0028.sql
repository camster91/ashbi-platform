ALTER TABLE projects ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
CREATE INDEX projects_archive ON projects(organization_id,archived,id);
CREATE TABLE source_pilot_objects_replacement (
 run_id TEXT NOT NULL, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN('notion','bonsai','legacy','fluentboards')), path TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE, size INTEGER NOT NULL CHECK(size BETWEEN 0 AND 5242880),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), fence INTEGER NOT NULL DEFAULT 1 CHECK(fence=1),
 PRIMARY KEY(run_id,source,path),
 FOREIGN KEY(run_id,organization_id,project_id) REFERENCES source_pilot_runs(id,organization_id,project_id)
);
INSERT INTO source_pilot_objects_replacement SELECT run_id,organization_id,project_id,source,path,object_key,size,sha256,fence FROM source_pilot_objects;
DROP TABLE source_pilot_objects;
ALTER TABLE source_pilot_objects_replacement RENAME TO source_pilot_objects;
CREATE TABLE files_replacement (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES actors(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 180), object_key TEXT NOT NULL UNIQUE,
 size INTEGER NOT NULL CHECK(size BETWEEN 1 AND 67108864), sha256 TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready')),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN (0,1)),
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)), revision INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
INSERT INTO files_replacement SELECT id,organization_id,project_id,actor_id,name,object_key,size,sha256,state,client_visible,deleted,revision,created_at FROM files;
DROP TABLE files;
ALTER TABLE files_replacement RENAME TO files;
CREATE INDEX files_org_id ON files(organization_id,id);
