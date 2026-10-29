ALTER TABLE tasks ADD COLUMN assignment_token TEXT;
ALTER TABLE tasks ADD COLUMN assigned_at INTEGER;
ALTER TABLE files ADD COLUMN notify_staff INTEGER NOT NULL DEFAULT 0 CHECK(notify_staff IN(0,1));
CREATE TABLE inbox_reads (
 organization_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','deadline','upload')),
 item_id TEXT NOT NULL, read_at INTEGER NOT NULL,
 PRIMARY KEY(organization_id,actor_id,kind,item_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE TABLE notification_preferences (
 organization_id TEXT NOT NULL, actor_id TEXT NOT NULL,
 messages INTEGER NOT NULL DEFAULT 1 CHECK(messages IN(0,1)),
 assignments INTEGER NOT NULL DEFAULT 1 CHECK(assignments IN(0,1)),
 deadlines INTEGER NOT NULL DEFAULT 1 CHECK(deadlines IN(0,1)),
 uploads INTEGER NOT NULL DEFAULT 1 CHECK(uploads IN(0,1)),
 PRIMARY KEY(organization_id,actor_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
CREATE INDEX tasks_notifications ON tasks(organization_id,assignee_id,due_on);
CREATE INDEX files_notifications ON files(organization_id,created_at DESC,id) WHERE notify_staff=1 AND state='ready' AND deleted=0;
