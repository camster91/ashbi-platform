ALTER TABLE project_messages ADD COLUMN mention_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(mention_ids) AND json_type(mention_ids)='array');
ALTER TABLE notification_preferences ADD COLUMN mentions INTEGER NOT NULL DEFAULT 1 CHECK(mentions IN(0,1));
