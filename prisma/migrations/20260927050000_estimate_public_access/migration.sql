-- Estimate public links move to the expiring, revocable capability-token
-- model used by invoices, proposals and contracts (security audit M1).
--
-- Additive columns. Every existing estimate viewToken (a cuid, not a secret)
-- is rotated to a 64-hex-character random value and left without an access
-- window, so links sent before this release stop working; staff re-send the
-- estimate to issue a new link. Rolling back the image is safe: older code
-- ignores the new columns and the rotated tokens are still unique strings.

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN "publicAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN "publicAccessRevokedAt" TIMESTAMP(3);

-- Rotate existing tokens (gen_random_uuid is built in since PostgreSQL 13;
-- two UUIDv4 values give 244 random bits).
UPDATE "estimates"
SET "viewToken" = replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
