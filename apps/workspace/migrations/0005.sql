ALTER TABLE notes ADD COLUMN history_token TEXT;
CREATE UNIQUE INDEX notes_history_token ON notes(history_token);
CREATE UNIQUE INDEX notes_org_id ON notes(id,organization_id);
CREATE TABLE note_versions (
 id TEXT PRIMARY KEY,
 note_id TEXT NOT NULL,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>=0),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 20000),
 client_visible INTEGER NOT NULL CHECK(client_visible IN(0,1)),
 recorded_at INTEGER,
 actor_id TEXT,
 source_revision INTEGER,
 UNIQUE(note_id,revision),
 FOREIGN KEY(note_id,organization_id) REFERENCES notes(id,organization_id),
 FOREIGN KEY(project_id,organization_id) REFERENCES projects(id,organization_id),
 FOREIGN KEY(actor_id,organization_id) REFERENCES actors(id,organization_id)
);
INSERT INTO note_versions(id,note_id,organization_id,project_id,revision,title,text,client_visible)
 SELECT lower(hex(randomblob(16))),id,organization_id,project_id,revision,title,text,client_visible FROM notes;
CREATE INDEX note_versions_page ON note_versions(organization_id,note_id,revision DESC);
