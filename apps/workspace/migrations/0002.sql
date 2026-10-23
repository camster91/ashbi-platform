ALTER TABLE clients ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE clients ADD COLUMN company TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('planned','active','complete'));
ALTER TABLE tasks ADD COLUMN assignee_id TEXT REFERENCES actors(id);
ALTER TABLE tasks ADD COLUMN due_on TEXT;
