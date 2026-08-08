-- Fail closed if ownership drift appeared after the pre-deployment audit.
-- Existing tenant records must never be guessed into an organization.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM users WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM clients WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM projects WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM integrations WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM trashed_items WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM support_hours WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_sites WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_backups WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_reports WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_alerts WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_fleet_ops WHERE "organizationId" IS NULL
    UNION ALL SELECT 1 FROM wp_magic_login_log WHERE "organizationId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Tenant migration aborted: ownerless records require explicit quarantine or assignment';
  END IF;

  IF EXISTS (
    SELECT 1 FROM assignment_rules
    UNION ALL SELECT 1 FROM templates
    UNION ALL SELECT 1 FROM unmatched_emails
    UNION ALL SELECT 1 FROM line_item_templates
    UNION ALL SELECT 1 FROM weekly_digests
    UNION ALL SELECT 1 FROM task_templates
    UNION ALL SELECT 1 FROM outreach_sequences
    UNION ALL SELECT 1 FROM email_triage_items
    UNION ALL SELECT 1 FROM ai_context
    UNION ALL SELECT 1 FROM ash_conversations
    UNION ALL SELECT 1 FROM project_templates
    UNION ALL SELECT 1 FROM brand_settings
    UNION ALL SELECT 1 FROM pipeline_stages
    UNION ALL SELECT 1 FROM prompt_versions
  ) THEN
    RAISE EXCEPTION 'Tenant migration aborted: formerly ownerless roots require explicit quarantine or assignment';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "projects" DROP CONSTRAINT "projects_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "support_hours" DROP CONSTRAINT "support_hours_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_alerts" DROP CONSTRAINT "wp_alerts_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_backups" DROP CONSTRAINT "wp_backups_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_fleet_ops" DROP CONSTRAINT "wp_fleet_ops_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_magic_login_log" DROP CONSTRAINT "wp_magic_login_log_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_reports" DROP CONSTRAINT "wp_reports_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "wp_sites" DROP CONSTRAINT "wp_sites_organizationId_fkey";

-- AlterTable
ALTER TABLE "ai_context" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ash_conversations" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "assignment_rules" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "brand_settings" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "clients" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "email_triage_items" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "integrations" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "line_item_templates" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "outreach_sequences" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "project_templates" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "projects" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "prompt_versions" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "support_hours" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "task_templates" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "templates" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "trashed_items" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "unmatched_emails" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "weekly_digests" ADD COLUMN     "organizationId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "wp_alerts" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "wp_backups" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "wp_fleet_ops" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "wp_magic_login_log" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "wp_reports" ALTER COLUMN "organizationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "wp_sites" ALTER COLUMN "organizationId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ai_context_organizationId_idx" ON "ai_context"("organizationId");

-- CreateIndex
CREATE INDEX "ash_conversations_organizationId_idx" ON "ash_conversations"("organizationId");

-- CreateIndex
CREATE INDEX "assignment_rules_organizationId_idx" ON "assignment_rules"("organizationId");

-- CreateIndex
CREATE INDEX "brand_settings_organizationId_idx" ON "brand_settings"("organizationId");

-- CreateIndex
CREATE INDEX "email_triage_items_organizationId_idx" ON "email_triage_items"("organizationId");

-- CreateIndex
CREATE INDEX "line_item_templates_organizationId_idx" ON "line_item_templates"("organizationId");

-- CreateIndex
CREATE INDEX "outreach_sequences_organizationId_idx" ON "outreach_sequences"("organizationId");

-- CreateIndex
CREATE INDEX "pipeline_stages_organizationId_idx" ON "pipeline_stages"("organizationId");

-- CreateIndex
CREATE INDEX "project_templates_organizationId_idx" ON "project_templates"("organizationId");

-- CreateIndex
CREATE INDEX "prompt_versions_organizationId_idx" ON "prompt_versions"("organizationId");

-- CreateIndex
CREATE INDEX "task_templates_organizationId_idx" ON "task_templates"("organizationId");

-- CreateIndex
CREATE INDEX "templates_organizationId_idx" ON "templates"("organizationId");

-- CreateIndex
CREATE INDEX "unmatched_emails_organizationId_idx" ON "unmatched_emails"("organizationId");

-- CreateIndex
CREATE INDEX "weekly_digests_organizationId_idx" ON "weekly_digests"("organizationId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_rules" ADD CONSTRAINT "assignment_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmatched_emails" ADD CONSTRAINT "unmatched_emails_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "line_item_templates" ADD CONSTRAINT "line_item_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_digests" ADD CONSTRAINT "weekly_digests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_sequences" ADD CONSTRAINT "outreach_sequences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_triage_items" ADD CONSTRAINT "email_triage_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_context" ADD CONSTRAINT "ai_context_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ash_conversations" ADD CONSTRAINT "ash_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_templates" ADD CONSTRAINT "project_templates_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand_settings" ADD CONSTRAINT "brand_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_hours" ADD CONSTRAINT "support_hours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trashed_items" ADD CONSTRAINT "trashed_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_sites" ADD CONSTRAINT "wp_sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_backups" ADD CONSTRAINT "wp_backups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_reports" ADD CONSTRAINT "wp_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_alerts" ADD CONSTRAINT "wp_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_fleet_ops" ADD CONSTRAINT "wp_fleet_ops_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wp_magic_login_log" ADD CONSTRAINT "wp_magic_login_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
