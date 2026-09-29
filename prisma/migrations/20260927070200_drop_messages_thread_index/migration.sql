-- The composite messages(threadId, receivedAt) index from the previous
-- migration now serves every threadId lookup. DROP INDEX CONCURRENTLY avoids
-- the ACCESS EXCLUSIVE lock a plain DROP takes on messages; like CREATE INDEX
-- CONCURRENTLY it must be the only statement in its migration.
DROP INDEX CONCURRENTLY IF EXISTS "messages_threadId_idx";
