-- Client-visible project chat (C3): every chat message now carries a
-- visibility. INTERNAL messages are staff-only team chat; CLIENT messages form
-- the client-portal conversation. Existing staff chat and Slack imports become
-- INTERNAL, so clients stop seeing past internal chat — that is the fix.
-- Messages clients wrote themselves through the portal (authored by a
-- CLIENT-role user) are backfilled as CLIENT so their own conversation stays
-- visible to them.
--
-- `removedAt` tombstones a deleted message that still has replies (M2): the
-- self-referencing reply FK is ON DELETE NO ACTION, so such a parent cannot be
-- removed without deleting other people's replies.
--
-- Additive and safe on a live database: a constant-default NOT NULL column is
-- a catalog-only change on PostgreSQL 11+, the nullable column needs no
-- rewrite, the backfill touches only client-authored rows, and the old
-- application image ignores both columns.

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "chat_messages" ADD COLUMN "removedAt" TIMESTAMP(3);

-- Backfill: the portal conversation the clients themselves wrote.
UPDATE "chat_messages"
SET "visibility" = 'CLIENT'
WHERE "authorId" IN (SELECT "id" FROM "users" WHERE "role" = 'CLIENT');

-- Only the two known visibilities are valid. Migrations run in one
-- transaction, so this validates in place; the table is small and every row
-- already satisfies the check.
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_visibility_check" CHECK ("visibility" IN ('INTERNAL', 'CLIENT'));

-- CreateIndex
CREATE INDEX "chat_messages_projectId_visibility_createdAt_idx" ON "chat_messages"("projectId", "visibility", "createdAt");
