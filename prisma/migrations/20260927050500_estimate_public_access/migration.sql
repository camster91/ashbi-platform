-- Estimate public links move to the expiring, revocable capability-token
-- model used by invoices, proposals and contracts (security audit M1).
--
-- Additive columns. Every existing estimate viewToken (a cuid, not a secret)
-- is rotated to a 64-hex-character random value, so links emailed before this
-- release stop working:
--   * SENT estimates get an access window at once (validUntil when it is
--     still in the future, otherwise 30 days from now), so staff can copy the
--     new link from the estimate (or reissue it: POST /api/estimates/:id/reissue-link)
--     without re-sending.
--   * DRAFT and answered estimates get no window; sending a draft issues one.
-- Rolling back the image is safe: older code ignores the new columns and the
-- rotated tokens are still unique strings.
--
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT makes the column additions and the rotation
-- all-or-nothing: the columns never exist without the rotation (which would
-- leave the old cuid links live with no access window). The ALTER takes an
-- ACCESS EXCLUSIVE lock on "estimates" (a small table) until COMMIT; the
-- lock_timeout makes the deploy fail fast and roll back cleanly instead of
-- queueing behind a long transaction; rerun it when the database is quieter.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN "publicAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN "publicAccessRevokedAt" TIMESTAMP(3);

-- Rotate existing tokens (gen_random_uuid is built in since PostgreSQL 13;
-- two UUIDv4 values give 244 random bits) and open a window for SENT ones.
UPDATE "estimates"
SET "viewToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
    "publicAccessExpiresAt" = CASE
      WHEN "status" = 'SENT' AND "validUntil" > CURRENT_TIMESTAMP THEN "validUntil"
      WHEN "status" = 'SENT' THEN CURRENT_TIMESTAMP + INTERVAL '30 days'
      ELSE NULL
    END;

COMMIT;
