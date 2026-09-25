-- Optional per-user TOTP multi-factor authentication for staff accounts.
-- Additive only: every column is nullable or has a default, so existing
-- users keep signing in with a password until they enroll.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mfaLastUsedStep" INTEGER,
ADD COLUMN     "mfaLockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaRecoveryCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaSecret" TEXT;
