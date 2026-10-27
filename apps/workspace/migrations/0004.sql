CREATE UNIQUE INDEX tasks_org_id ON tasks(id,organization_id);
CREATE UNIQUE INDEX actors_org_id ON actors(id,organization_id);
CREATE TABLE task_comments (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 task_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 10000),
 client_visible INTEGER NOT NULL DEFAULT 0 CHECK(client_visible IN(0,1)),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 UNIQUE(organization_id,actor_id,request_id),
 FOREIGN KEY(task_id,organization_id) REFERENCES tasks(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX task_comments_page ON task_comments(organization_id,task_id,created_at DESC,id DESC);
