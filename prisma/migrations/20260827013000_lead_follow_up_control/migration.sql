ALTER TABLE "leads"
ADD COLUMN "qualificationReasonCode" TEXT,
ADD COLUMN "nextAction" TEXT,
ADD COLUMN "nextActionDueAt" TIMESTAMP(3);

CREATE INDEX "leads_organizationId_status_nextActionDueAt_idx"
ON "leads"("organizationId", "status", "nextActionDueAt");
