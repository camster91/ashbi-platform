-- Soft Delete Migration
-- Adds deletedAt column and index to all major entities

ALTER TABLE "clients" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "clients_deletedAt_idx" ON "clients"("deletedAt");

ALTER TABLE "projects" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "projects_deletedAt_idx" ON "projects"("deletedAt");

ALTER TABLE "tasks" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "tasks_deletedAt_idx" ON "tasks"("deletedAt");

ALTER TABLE "proposals" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "proposals_deletedAt_idx" ON "proposals"("deletedAt");

ALTER TABLE "contracts" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "contracts_deletedAt_idx" ON "contracts"("deletedAt");

ALTER TABLE "invoices" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "invoices_deletedAt_idx" ON "invoices"("deletedAt");

ALTER TABLE "expenses" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "expenses_deletedAt_idx" ON "expenses"("deletedAt");

ALTER TABLE "estimates" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "estimates_deletedAt_idx" ON "estimates"("deletedAt");

ALTER TABLE "retainer_plans" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "retainer_plans_deletedAt_idx" ON "retainer_plans"("deletedAt");

ALTER TABLE "outreach_sequences" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "outreach_sequences_deletedAt_idx" ON "outreach_sequences"("deletedAt");

ALTER TABLE "pipeline_deals" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "pipeline_deals_deletedAt_idx" ON "pipeline_deals"("deletedAt");