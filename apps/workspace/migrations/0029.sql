ALTER TABLE projects ADD COLUMN client_uploads INTEGER NOT NULL DEFAULT 0 CHECK(client_uploads IN (0,1));
