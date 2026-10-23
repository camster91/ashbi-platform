CREATE TABLE actors (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('staff','client')), client_id TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 CHECK((role='staff' AND client_id IS NULL) OR (role='client' AND client_id IS NOT NULL))
);
CREATE TABLE clients (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 revision INTEGER NOT NULL DEFAULT 0, UNIQUE(id,organization_id)
);
CREATE TABLE projects (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200), revision INTEGER NOT NULL DEFAULT 0,
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 UNIQUE(id,organization_id), FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id)
);
CREATE INDEX projects_client ON projects(organization_id,client_id,client_visible,id);
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN('todo','doing','done')),
 revision INTEGER NOT NULL DEFAULT 0, client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
CREATE INDEX tasks_project ON tasks(organization_id,project_id,client_visible,id);
CREATE TABLE notes (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 20000),
 revision INTEGER NOT NULL DEFAULT 0, client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
CREATE INDEX notes_project ON notes(organization_id,project_id,client_visible,id);
CREATE TABLE time_entries (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES actors(id),
 started_at INTEGER NOT NULL, ended_at INTEGER, seconds INTEGER NOT NULL DEFAULT 0 CHECK(seconds>=0),
 CHECK(ended_at IS NULL OR ended_at>=started_at),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
CREATE UNIQUE INDEX one_running_timer ON time_entries(actor_id) WHERE ended_at IS NULL;
CREATE INDEX time_org ON time_entries(organization_id,actor_id,id);
