-- Controlled Slack workspace-export import (#414): a generic run ledger for
-- migration importers and durable per-message reconciliation records keyed by
-- Slack channel id + message ts, so reruns never duplicate and a run can be
-- rolled back by id.

-- CreateTable
CREATE TABLE "import_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPLIED',
    "sourceLabel" TEXT,
    "summary" JSONB,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_import_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "chatMessageId" TEXT,
    "sourceKey" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageTs" TEXT NOT NULL,
    "threadTs" TEXT,
    "contentSha256" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'IMPORTED',
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slack_import_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_runs_organizationId_source_createdAt_idx" ON "import_runs"("organizationId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "slack_import_records_organizationId_projectId_idx" ON "slack_import_records"("organizationId", "projectId");

-- CreateIndex
CREATE INDEX "slack_import_records_runId_idx" ON "slack_import_records"("runId");

-- CreateIndex
CREATE INDEX "slack_import_records_chatMessageId_idx" ON "slack_import_records"("chatMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_import_records_organizationId_sourceKey_key" ON "slack_import_records"("organizationId", "sourceKey");

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_import_records" ADD CONSTRAINT "slack_import_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_import_records" ADD CONSTRAINT "slack_import_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_import_records" ADD CONSTRAINT "slack_import_records_runId_fkey" FOREIGN KEY ("runId") REFERENCES "import_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma does not model CHECK constraints; they are enforced here only.
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_status_check" CHECK ("status" IN ('APPLIED', 'ROLLED_BACK'));
ALTER TABLE "slack_import_records" ADD CONSTRAINT "slack_import_records_outcome_check" CHECK ("outcome" IN ('IMPORTED'));
