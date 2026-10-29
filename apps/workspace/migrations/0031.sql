CREATE UNIQUE INDEX project_messages_org_id ON project_messages(id,organization_id);
CREATE TABLE project_message_reads (
 organization_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 read_at INTEGER NOT NULL CHECK(read_at>=0),
 PRIMARY KEY(organization_id,actor_id,message_id),
 FOREIGN KEY(message_id,organization_id) REFERENCES project_messages(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
