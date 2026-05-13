-- Add soft delete (deletedAt) to 10 core models
-- Run: psql $DATABASE_URL -f /tmp/add_soft_delete.sql

ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "retainer_plans" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;
ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3) WITHOUT TIME ZONE;

-- Add autosave draft (draftData) to 6 models
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "draftData" TEXT;
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "draftData" TEXT;
ALTER TABLE "contracts" ADD COLUMN IF NOT EXISTS "draftData" TEXT;
ALTER TABLE "estimates" ADD COLUMN IF NOT EXISTS "draftData" TEXT;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "draftData" TEXT;
ALTER TABLE "retainer_plans" ADD COLUMN IF NOT EXISTS "draftData" TEXT;

-- Create indexes for soft delete filtering
CREATE INDEX IF NOT EXISTS "clients_deletedAt_idx" ON "clients"("deletedAt");
CREATE INDEX IF NOT EXISTS "projects_deletedAt_idx" ON "projects"("deletedAt");
CREATE INDEX IF NOT EXISTS "proposals_deletedAt_idx" ON "proposals"("deletedAt");
CREATE INDEX IF NOT EXISTS "invoices_deletedAt_idx" ON "invoices"("deletedAt");
CREATE INDEX IF NOT EXISTS "tasks_deletedAt_idx" ON "tasks"("deletedAt");
CREATE INDEX IF NOT EXISTS "contracts_deletedAt_idx" ON "contracts"("deletedAt");
CREATE INDEX IF NOT EXISTS "estimates_deletedAt_idx" ON "estimates"("deletedAt");
CREATE INDEX IF NOT EXISTS "expenses_deletedAt_idx" ON "expenses"("deletedAt");
CREATE INDEX IF NOT EXISTS "retainer_plans_deletedAt_idx" ON "retainer_plans"("deletedAt");
CREATE INDEX IF NOT EXISTS "notes_deletedAt_idx" ON "notes"("deletedAt");
