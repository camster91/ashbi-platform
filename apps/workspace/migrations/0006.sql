CREATE UNIQUE INDEX notes_project_identity ON notes(id,organization_id,project_id);
CREATE TABLE note_positions (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 project_id TEXT NOT NULL,
 parent_id TEXT,
 archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
 UNIQUE(id,organization_id,project_id),
 FOREIGN KEY(id,organization_id,project_id) REFERENCES notes(id,organization_id,project_id),
 FOREIGN KEY(parent_id,organization_id,project_id) REFERENCES note_positions(id,organization_id,project_id)
);
INSERT INTO note_positions(id,organization_id,project_id) SELECT id,organization_id,project_id FROM notes;
CREATE INDEX note_positions_parent ON note_positions(organization_id,project_id,parent_id,id);
ALTER TABLE note_versions ADD COLUMN parent_id TEXT;
ALTER TABLE note_versions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1));
