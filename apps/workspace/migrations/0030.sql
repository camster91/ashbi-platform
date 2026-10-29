CREATE TABLE project_messages (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 request_id TEXT NOT NULL,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 10000),
 created_at INTEGER NOT NULL CHECK(created_at>=0),
 UNIQUE(organization_id,actor_id,request_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX project_messages_page ON project_messages(organization_id,project_id,created_at DESC,id DESC);
