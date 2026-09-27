-- Client-visible project chat (C3): every chat message now carries a
-- visibility. INTERNAL messages are staff-only team chat; CLIENT messages form
-- the client-portal conversation. Existing rows (team chat and Slack imports)
-- become INTERNAL, so clients stop seeing past internal chat — that is the fix.
--
-- `removedAt` tombstones a deleted message that still has replies (M2): the
-- self-referencing reply FK is ON DELETE NO ACTION, so such a parent cannot be
-- removed without deleting other people's replies.
--
-- Additive and safe on a live database: a constant-default NOT NULL column is
-- a catalog-only change on PostgreSQL 11+, the nullable column needs no
-- rewrite, and the old application image ignores both columns.

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "chat_messages" ADD COLUMN "removedAt" TIMESTAMP(3);

-- Only the two known visibilities are valid. Added NOT VALID and validated
-- separately so the scan runs under a lock that does not block writes.
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_visibility_check" CHECK ("visibility" IN ('INTERNAL', 'CLIENT')) NOT VALID;
ALTER TABLE "chat_messages" VALIDATE CONSTRAINT "chat_messages_visibility_check";

-- CreateIndex
CREATE INDEX "chat_messages_projectId_visibility_createdAt_idx" ON "chat_messages"("projectId", "visibility", "createdAt");
