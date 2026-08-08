
-- DropForeignKey
ALTER TABLE "outreach_leads" DROP CONSTRAINT "outreach_leads_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "cold_email_prospects" DROP CONSTRAINT "cold_email_prospects_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "cold_email_events" DROP CONSTRAINT "cold_email_events_prospectId_fkey";

-- DropForeignKey
ALTER TABLE "cold_email_events" DROP CONSTRAINT "cold_email_events_sequenceId_fkey";

-- DropForeignKey
ALTER TABLE "survey_responses" DROP CONSTRAINT "survey_responses_clientId_fkey";

-- DropForeignKey
ALTER TABLE "wp_sites" DROP CONSTRAINT "wp_sites_clientId_fkey";

-- DropForeignKey
ALTER TABLE "wp_sites" DROP CONSTRAINT "wp_sites_projectId_fkey";

-- DropForeignKey
ALTER TABLE "wp_backups" DROP CONSTRAINT "wp_backups_siteId_fkey";

-- DropForeignKey
ALTER TABLE "wp_reports" DROP CONSTRAINT "wp_reports_siteId_fkey";

-- DropForeignKey
ALTER TABLE "wp_alerts" DROP CONSTRAINT "wp_alerts_siteId_fkey";

-- DropForeignKey
ALTER TABLE "ad_copies" DROP CONSTRAINT "ad_copies_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ad_copies" DROP CONSTRAINT "ad_copies_projectId_fkey";

-- DropForeignKey
ALTER TABLE "content_calendar_events" DROP CONSTRAINT "content_calendar_events_clientId_fkey";

-- DropForeignKey
ALTER TABLE "content_calendar_events" DROP CONSTRAINT "content_calendar_events_projectId_fkey";

-- DropForeignKey
ALTER TABLE "content_calendar_events" DROP CONSTRAINT "content_calendar_events_assigneeId_fkey";

-- DropForeignKey
ALTER TABLE "seo_audits" DROP CONSTRAINT "seo_audits_clientId_fkey";

-- DropForeignKey
ALTER TABLE "seo_audits" DROP CONSTRAINT "seo_audits_projectId_fkey";

-- DropTable
DROP TABLE "outreach_leads";

-- DropTable
DROP TABLE "social_posts";

-- DropTable
DROP TABLE "blog_posts";

-- DropTable
DROP TABLE "content_drafts";

-- DropTable
DROP TABLE "linkedin_sequences";

-- DropTable
DROP TABLE "linkedin_prospects";

-- DropTable
DROP TABLE "cold_email_sequences";

-- DropTable
DROP TABLE "cold_email_prospects";

-- DropTable
DROP TABLE "cold_email_events";

-- DropTable
DROP TABLE "upwork_contracts";

-- DropTable
DROP TABLE "upwork_proposals";

-- DropTable
DROP TABLE "survey_responses";

-- DropTable
DROP TABLE "wp_sites";

-- DropTable
DROP TABLE "wp_backups";

-- DropTable
DROP TABLE "wp_reports";

-- DropTable
DROP TABLE "wp_alerts";

-- DropTable
DROP TABLE "ad_copies";

-- DropTable
DROP TABLE "content_calendar_events";

-- DropTable
DROP TABLE "seo_audits";

