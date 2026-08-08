-- Performance indexes for hot query columns.
-- Audit: 5-slice performance audit (2026-06-28) identified these columns as
-- missing indexes, causing full table scans on hot paths (cron jobs, webhooks,
-- dashboard queries). Each index is sized for its query pattern.

-- === Cold email (cron every minute + webhook on every open/click) ===
CREATE INDEX IF NOT EXISTS "cold_email_prospects_nextEmailAt_status_idx"
  ON "cold_email_prospects"("nextEmailAt", "status");
CREATE INDEX IF NOT EXISTS "cold_email_prospects_status_idx"
  ON "cold_email_prospects"("status");
CREATE INDEX IF NOT EXISTS "cold_email_prospects_createdAt_idx"
  ON "cold_email_prospects"("createdAt");

CREATE INDEX IF NOT EXISTS "cold_email_events_mailgunId_idx"
  ON "cold_email_events"("mailgunId");
CREATE INDEX IF NOT EXISTS "cold_email_events_prospectId_type_idx"
  ON "cold_email_events"("prospectId", "type");

-- === Outreach / LinkedIn / Email triage (lead pipelines) ===
CREATE INDEX IF NOT EXISTS "outreach_leads_status_idx"
  ON "outreach_leads"("status");
CREATE INDEX IF NOT EXISTS "outreach_leads_lastContactedAt_status_idx"
  ON "outreach_leads"("lastContactedAt", "status");

CREATE INDEX IF NOT EXISTS "linkedin_prospects_status_idx"
  ON "linkedin_prospects"("status");
CREATE INDEX IF NOT EXISTS "linkedin_prospects_createdAt_idx"
  ON "linkedin_prospects"("createdAt");

CREATE INDEX IF NOT EXISTS "linkedin_sequences_status_idx"
  ON "linkedin_sequences"("status");
CREATE INDEX IF NOT EXISTS "outreach_sequences_status_idx"
  ON "outreach_sequences"("status");

CREATE INDEX IF NOT EXISTS "email_triage_items_status_idx"
  ON "email_triage_items"("status");
CREATE INDEX IF NOT EXISTS "email_triage_items_createdAt_idx"
  ON "email_triage_items"("createdAt");

-- === Analytics (response-times, dashboard, calendar) ===
CREATE INDEX IF NOT EXISTS "responses_status_idx"
  ON "responses"("status");
CREATE INDEX IF NOT EXISTS "responses_createdAt_idx"
  ON "responses"("createdAt");

CREATE INDEX IF NOT EXISTS "calendar_events_startTime_idx"
  ON "calendar_events"("startTime");
CREATE INDEX IF NOT EXISTS "calendar_events_projectId_startTime_idx"
  ON "calendar_events"("projectId", "startTime");

CREATE INDEX IF NOT EXISTS "threads_createdAt_idx"
  ON "threads"("createdAt");

CREATE INDEX IF NOT EXISTS "time_entries_userId_date_idx"
  ON "time_entries"("userId", "date");

-- === WordPress / Blog (content pipelines) ===
CREATE INDEX IF NOT EXISTS "wp_sites_status_idx"
  ON "wp_sites"("status");
CREATE INDEX IF NOT EXISTS "blog_posts_status_publishedAt_idx"
  ON "blog_posts"("status", "publishedAt");

-- === Proposals / Contracts / Retainer (billing pipelines) ===
CREATE INDEX IF NOT EXISTS "proposals_status_idx"
  ON "proposals"("status");
CREATE INDEX IF NOT EXISTS "proposals_clientId_status_idx"
  ON "proposals"("clientId", "status");
CREATE INDEX IF NOT EXISTS "proposals_validUntil_idx"
  ON "proposals"("validUntil");

CREATE INDEX IF NOT EXISTS "contracts_status_idx"
  ON "contracts"("status");
CREATE INDEX IF NOT EXISTS "contracts_clientId_status_idx"
  ON "contracts"("clientId", "status");

CREATE INDEX IF NOT EXISTS "retainer_plans_retainerStatus_idx"
  ON "retainer_plans"("retainerStatus");
CREATE INDEX IF NOT EXISTS "retainer_plans_clientId_retainerStatus_idx"
  ON "retainer_plans"("clientId", "retainerStatus");

-- === Assignment rules (workflow routing) ===
CREATE INDEX IF NOT EXISTS "assignment_rules_isActive_idx"
  ON "assignment_rules"("isActive");

-- === Email matching (parseAndMatchEmail full scans) ===
CREATE INDEX IF NOT EXISTS "unmatched_emails_senderEmail_idx"
  ON "unmatched_emails"("senderEmail");
CREATE INDEX IF NOT EXISTS "unmatched_emails_createdAt_idx"
  ON "unmatched_emails"("createdAt");