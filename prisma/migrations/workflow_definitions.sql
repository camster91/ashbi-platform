-- Workflow Automation Definitions
CREATE TABLE IF NOT EXISTS "workflow_definitions" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "trigger" TEXT NOT NULL,
  "triggerConfig" TEXT NOT NULL DEFAULT '{}',
  "conditions" TEXT NOT NULL DEFAULT '[]',
  "actions" TEXT NOT NULL DEFAULT '[]',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isPaused" BOOLEAN NOT NULL DEFAULT false,
  "runCount" INTEGER NOT NULL DEFAULT 0,
  "lastRunAt" TIMESTAMP(3),
  "lastRunStatus" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "workflow_definitions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_definitions_isActive_trigger_idx" ON "workflow_definitions"("isActive", "trigger");

ALTER TABLE "workflow_definitions" ADD CONSTRAINT "workflow_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Workflow Execution Runs
CREATE TABLE IF NOT EXISTS "workflow_runs" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "trigger" TEXT NOT NULL,
  "triggerData" TEXT,
  "actions" TEXT NOT NULL DEFAULT '[]',
  "error" TEXT,
  "durationMs" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "workflow_runs_workflowId_startedAt_idx" ON "workflow_runs"("workflowId", "startedAt");

ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflow_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
