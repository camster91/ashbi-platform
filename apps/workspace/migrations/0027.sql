PRAGMA defer_foreign_keys=ON;
CREATE TABLE projects_replacement (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200), revision INTEGER NOT NULL DEFAULT 0,
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('planned','active','waiting','complete','canceled')),
 UNIQUE(id,organization_id), FOREIGN KEY(client_id,organization_id) REFERENCES clients(id,organization_id)
);
INSERT INTO projects_replacement SELECT id,organization_id,client_id,name,revision,client_visible,status FROM projects;
DROP TABLE projects;
ALTER TABLE projects_replacement RENAME TO projects;
CREATE INDEX projects_client ON projects(organization_id,client_id,client_visible,id);
CREATE TABLE tasks_replacement (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN('todo','doing','review','waiting','later','done','retired','archived')),
 revision INTEGER NOT NULL DEFAULT 0, client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 assignee_id TEXT REFERENCES actors(id), due_on TEXT,
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id)
);
INSERT INTO tasks_replacement SELECT id,organization_id,project_id,title,status,revision,client_visible,assignee_id,due_on FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_replacement RENAME TO tasks;
CREATE INDEX tasks_project ON tasks(organization_id,project_id,client_visible,id);
CREATE UNIQUE INDEX tasks_org_id ON tasks(id,organization_id);
PRAGMA defer_foreign_keys=OFF;
