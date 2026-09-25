-- API key scopes and revocation timestamp (#416).
--
-- Additive only. Existing keys keep exactly the access they had: before this
-- migration every active key could call every AI bridge route, so each
-- existing key is backfilled with both bridge scopes. Keys already revoked
-- (isActive = false) get revokedAt = their last update time. expiresAt is
-- left untouched: keys created without an expiry keep working and are
-- flagged "no expiry" in the settings list. New keys must choose scopes and
-- an expiry (enforced by POST /api/api-keys).

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: preserve existing keys' behaviour.
UPDATE "api_keys" SET "scopes" = ARRAY['ai_bridge:read', 'ai_bridge:actions']::TEXT[];
UPDATE "api_keys" SET "revokedAt" = "updatedAt" WHERE "isActive" = false;
