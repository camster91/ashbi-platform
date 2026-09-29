-- Chat media (docs/chat-media.md): the chat message list loads the files of
-- every visible message in one query (entityType = 'CHAT' AND entityId IN
-- (...)), the client portal checks a chat file against its message, and the
-- hourly purge finds unsent CHAT_PENDING uploads. None of these had an index
-- beyond organizationId.
--
-- Locking: the explicit BEGIN/COMMIT keeps the migration atomic (Prisma does
-- not wrap a PostgreSQL migration in a transaction). CREATE INDEX holds a SHARE
-- lock on attachments (blocks writes, not reads) until COMMIT; the table is
-- small, so the build takes well under a second. lock_timeout makes the deploy
-- fail fast and roll back cleanly instead of queueing behind a long
-- transaction; rerun it when the database is quieter.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");

COMMIT;
