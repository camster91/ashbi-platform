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
-- rewrite, and the backfill touches only client-authored rows. Images that
-- predate this migration do not filter on visibility, so the release script's
-- rollback floor (scripts/deploy-vps-direct.sh) never lets one serve again
-- once this is applied.

-- Prisma does not wrap a migration in a transaction, so this one is explicit:
-- the column, backfill, check constraint and index apply together or not at
-- all.
BEGIN;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE "chat_messages" ADD COLUMN "removedAt" TIMESTAMP(3);

-- Replies are one level deep: re-parent any reply to a reply onto the first
-- message of its thread (depth-guarded so a malformed cycle cannot loop).
WITH RECURSIVE chain AS (
  SELECT "id", "parentId" AS "rootId", 1 AS depth
  FROM "chat_messages" WHERE "parentId" IS NOT NULL
  UNION ALL
  SELECT c."id", p."parentId", c.depth + 1
  FROM chain c JOIN "chat_messages" p ON p."id" = c."rootId"
  WHERE p."parentId" IS NOT NULL AND c.depth < 50
)
UPDATE "chat_messages" AS m
SET "parentId" = c."rootId"
FROM chain c JOIN "chat_messages" r ON r."id" = c."rootId" AND r."parentId" IS NULL
WHERE m."id" = c."id" AND m."parentId" IS DISTINCT FROM c."rootId";

-- Backfill: the portal conversation the clients themselves wrote, i.e.
-- messages by a CLIENT-role user on a project of that user's own client. The
-- current role alone is not enough: an account changed to CLIENT (possibly
-- without a clientId) keeps its earlier staff messages INTERNAL.
UPDATE "chat_messages" AS m
SET "visibility" = 'CLIENT'
FROM "users" AS u, "projects" AS p
WHERE m."authorId" = u."id"
  AND m."projectId" = p."id"
  AND u."role" = 'CLIENT'
  AND u."clientId" IS NOT NULL
  AND u."clientId" = p."clientId";

-- Only the two known visibilities are valid. Validated in place inside this
-- transaction; every row already satisfies the check after the backfill.
ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_visibility_check" CHECK ("visibility" IN ('INTERNAL', 'CLIENT'));

-- CreateIndex
CREATE INDEX "chat_messages_projectId_visibility_createdAt_idx" ON "chat_messages"("projectId", "visibility", "createdAt");

COMMIT;
