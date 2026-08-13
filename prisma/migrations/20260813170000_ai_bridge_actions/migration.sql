-- User-confirmed, idempotent action ledger for the ChatGPT/Codex bridge.
CREATE TABLE "ai_bridge_actions" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "inputHash" TEXT NOT NULL,
  "preview" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "result" JSONB,
  "errorCode" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "executedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_bridge_actions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ai_bridge_actions_userId_idempotencyKey_key" ON "ai_bridge_actions"("userId", "idempotencyKey");
CREATE INDEX "ai_bridge_actions_organizationId_status_createdAt_idx" ON "ai_bridge_actions"("organizationId", "status", "createdAt");
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
