-- Client-visible project files. The client portal's project Documents tab
-- listed every PROJECT attachment, including staff screen recordings and
-- internal working files. attachments."clientVisible" makes listing a file
-- to the client an explicit staff choice (default false).
--
-- Backfill: project files with evidence of a client upload were always the
-- client's to see, so they stay visible. Any one of:
--   1. the uploader is a CLIENT-role user (portal uploads since 51b40ff);
--   2. a FILE_UPLOADED activity for the attachment (entityType ATTACHMENT,
--      entityId = the attachment id, as written by POST /api/attachments)
--      was recorded by a CLIENT-role user;
--   3. the uploader's email matches a contact of the project's client
--      (case-insensitive): before 51b40ff portal uploads were attributed to
--      `user.findFirst({ email: contact.email })`, whatever that user's role.
-- Everything else (staff files, including screen recordings) starts hidden
-- and must be re-shared from the project's Files list.
--
-- Idempotent: the column is added only if missing and the backfill only sets
-- rows that are still hidden. Additive only: older application images never
-- read the column, so rolling back the image is safe (they would list every
-- file again, as before).
--
-- No explicit BEGIN/COMMIT: Prisma sends the file as one multi-statement
-- query, which PostgreSQL runs in a single implicit transaction (SET LOCAL
-- applies to it).
SET LOCAL lock_timeout = '5s';

ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "clientVisible" BOOLEAN NOT NULL DEFAULT false;

UPDATE "attachments" AS a
SET "clientVisible" = true
WHERE a."entityType" = 'PROJECT'
  AND a."clientVisible" = false
  AND (
    EXISTS (
      SELECT 1 FROM "users" AS u
      WHERE u."id" = a."uploadedById" AND u."role" = 'CLIENT'
    )
    OR EXISTS (
      SELECT 1 FROM "activities" AS act
      JOIN "users" AS actor ON actor."id" = act."userId"
      WHERE act."type" = 'FILE_UPLOADED'
        AND act."entityType" = 'ATTACHMENT'
        AND act."entityId" = a."id"
        AND actor."role" = 'CLIENT'
    )
    OR EXISTS (
      SELECT 1 FROM "users" AS u
      JOIN "projects" AS p ON p."id" = a."entityId"
      JOIN "contacts" AS c ON c."clientId" = p."clientId"
      WHERE u."id" = a."uploadedById"
        AND lower(u."email") = lower(c."email")
    )
  );
