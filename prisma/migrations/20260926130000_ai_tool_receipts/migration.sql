-- Governed AI tool registry, approval queue and execution receipts (#413
-- slice 2, docs/ai-tool-registry.md).
--
-- Additive only. ai_bridge_actions becomes the approval queue and receipt
-- store for every governed tool call. Existing rows keep their values: they
-- came from the AI bridge (source = 'ai_bridge') and every bridge action is an
-- execute tool (toolClass = 'execute'). Rolling back the application image is
-- safe: the old code ignores the new columns, and never updates a row after
-- it reaches a terminal status.

-- AlterTable
ALTER TABLE "ai_bridge_actions" ADD COLUMN     "approvalEvidence" JSONB,
ADD COLUMN     "approverId" TEXT,
ADD COLUMN     "correlationId" TEXT,
ADD COLUMN     "inputScope" JSONB,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'ai_bridge',
ADD COLUMN     "toolClass" TEXT NOT NULL DEFAULT 'execute';

-- CreateIndex
CREATE INDEX "ai_bridge_actions_organizationId_action_createdAt_idx" ON "ai_bridge_actions"("organizationId", "action", "createdAt");

-- Closed vocabularies. Prisma does not model CHECK constraints; they are
-- enforced here only.
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_status_check"
  CHECK ("status" IN ('PENDING_CONFIRMATION', 'EXECUTING', 'EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED'));
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_outcome_check"
  CHECK ("outcome" IS NULL OR "outcome" IN ('succeeded', 'failed', 'unknown'));
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_source_check"
  CHECK ("source" IN ('ai_bridge', 'assistant'));
ALTER TABLE "ai_bridge_actions" ADD CONSTRAINT "ai_bridge_actions_tool_class_check"
  CHECK ("toolClass" IN ('prepare', 'execute'));

-- A receipt is immutable once its action reached a terminal status: no role
-- with table write access can rewrite who approved it, what it did or how it
-- ended. Pending and executing rows still move forward. Deletes are left to
-- the organization and user lifecycle (ON DELETE CASCADE; retention is #310).
CREATE OR REPLACE FUNCTION deny_ai_action_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED') THEN
    RAISE EXCEPTION 'AI action receipts are immutable once %', OLD."status"
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_bridge_actions_receipt_immutable
BEFORE UPDATE ON "ai_bridge_actions"
FOR EACH ROW EXECUTE FUNCTION deny_ai_action_receipt_mutation();
