CREATE TABLE actors (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('staff', 'client')), client_id TEXT,
  CHECK ((role = 'staff' AND client_id IS NULL) OR (role = 'client' AND client_id IS NOT NULL))
);
CREATE TABLE clients (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, UNIQUE(id, organization_id));
CREATE TABLE login_codes (
  code_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id),
  expires_at INTEGER NOT NULL, consumed INTEGER NOT NULL CHECK(consumed IN (0, 1))
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actors(id), expires_at INTEGER NOT NULL
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, client_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 2000),
  client_visible INTEGER NOT NULL CHECK(client_visible IN (0, 1)), revision INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(client_id, organization_id) REFERENCES clients(id, organization_id)
);
CREATE INDEX notes_client ON notes(organization_id, client_id, client_visible);
