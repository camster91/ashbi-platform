-- Organization-scoped BYOK AI provider connections, usage metering and the
-- per-organization AI kill switch (#413 slice 1, docs/ai-byok.md).
--
-- Additive only: one defaulted column and two new tables. Every existing
-- organization gets aiDisabled = false and no connection, so AI keeps using
-- the platform provider exactly as before; rolling back the application
-- image is safe.

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "aiDisabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_provider_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "providerKind" TEXT NOT NULL DEFAULT 'openai_compatible',
    "baseUrl" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "keyLast4" TEXT,
    "allowedModels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultModel" TEXT NOT NULL,
    "monthlyBudgetCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "disabledReason" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "lastValidationError" TEXT,
    "createdById" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_connections_pkey" PRIMARY KEY ("id"),
    -- Prisma does not model CHECK constraints; they are enforced here only.
    CONSTRAINT "ai_provider_connections_providerKind_check"
      CHECK ("providerKind" IN ('openai_compatible')),
    CONSTRAINT "ai_provider_connections_status_check"
      CHECK ("status" IN ('active', 'disabled', 'revoked')),
    CONSTRAINT "ai_provider_connections_budget_check"
      CHECK ("monthlyBudgetCents" >= 0),
    -- An active connection always has a key; a revoked one never keeps one.
    CONSTRAINT "ai_provider_connections_key_state_check"
      CHECK (("status" = 'revoked' AND "encryptedApiKey" IS NULL)
          OR ("status" = 'active' AND "encryptedApiKey" IS NOT NULL)
          OR "status" = 'disabled')
);

-- CreateTable
CREATE TABLE "ai_usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostCents" DOUBLE PRECISION,
    "feature" TEXT,
    "requestId" TEXT,
    "success" BOOLEAN NOT NULL,
    "errorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ai_usage_records_tokens_check"
      CHECK ("promptTokens" >= 0 AND "completionTokens" >= 0),
    CONSTRAINT "ai_usage_records_cost_check"
      CHECK ("estimatedCostCents" IS NULL OR "estimatedCostCents" >= 0)
);

-- At most one connection per organization (connect, rotate and revoke update
-- the row in place), so at most one active connection.
-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_connections_organizationId_key" ON "ai_provider_connections"("organizationId");

-- CreateIndex
CREATE INDEX "ai_usage_records_organizationId_createdAt_idx" ON "ai_usage_records"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_records_connectionId_createdAt_idx" ON "ai_usage_records"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_provider_connections" ADD CONSTRAINT "ai_provider_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ai_provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
