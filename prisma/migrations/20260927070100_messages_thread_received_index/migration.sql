-- messages(threadId, receivedAt) serves thread timelines and supersedes
-- messages(threadId). Built CONCURRENTLY (writes continue during the build);
-- that requires the statement to be alone in its migration so it does not run
-- inside a transaction. If it fails, Postgres leaves an INVALID index: run
-- DROP INDEX CONCURRENTLY IF EXISTS "messages_threadId_receivedAt_idx";, then
-- `npx prisma migrate resolve --rolled-back 20260927070100_messages_thread_received_index`
-- and redeploy.
CREATE INDEX CONCURRENTLY "messages_threadId_receivedAt_idx" ON "messages"("threadId", "receivedAt");
