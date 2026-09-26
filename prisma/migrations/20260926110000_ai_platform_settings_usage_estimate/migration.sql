-- Persisted deployment AI kill switch and estimated-usage flag (#413 slice 1
-- security review, docs/ai-byok.md).
--
-- Additive only. platform_settings holds one row (id = 'platform'); with no
-- row the operator switch is off, which is today's behaviour. Existing usage
-- records keep usageEstimated = false (they were all provider-reported).

-- AlterTable
ALTER TABLE "ai_usage_records" ADD COLUMN     "usageEstimated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "aiDisabled" BOOLEAN NOT NULL DEFAULT false,
    "aiDisabledAt" TIMESTAMP(3),
    "aiDisabledById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id"),
    -- A single deployment-wide row. Prisma does not model CHECK constraints.
    CONSTRAINT "platform_settings_singleton_check" CHECK ("id" = 'platform')
);
