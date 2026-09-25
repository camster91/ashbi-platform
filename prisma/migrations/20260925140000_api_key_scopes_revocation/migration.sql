-- API key scopes and revocation timestamp (#416).
--
-- Additive only. Existing keys keep exactly the access they had: before this
-- migration every active key could call every AI bridge route, so each
-- existing key is backfilled with both bridge scopes. Keys already revoked
-- (isActive = false) get revokedAt = their last update time. Active keys
-- created without an expiry keep working for 90 more days, then expire like
-- any other key (service credentials must expire or rotate, #416); the
-- settings list shows the date so owners can rotate them. New keys must
-- choose scopes and an expiry (enforced by POST /api/api-keys).

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: preserve existing keys' behaviour.
UPDATE "api_keys" SET "scopes" = ARRAY['ai_bridge:read', 'ai_bridge:actions']::TEXT[];
UPDATE "api_keys" SET "revokedAt" = "updatedAt" WHERE "isActive" = false;
UPDATE "api_keys" SET "expiresAt" = NOW() + INTERVAL '90 days' WHERE "expiresAt" IS NULL AND "isActive" = true;
