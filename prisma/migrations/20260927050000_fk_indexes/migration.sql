-- Indexes for relation foreign-key columns that had none (joins, cascades and
-- "children of X" queries were sequential scans), plus messages(threadId,
-- receivedAt) for thread timelines, which supersedes messages(threadId).
-- src/tests/unit/schema-fk-indexes.test.js keeps new relations indexed.
--
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma runs each migration in a
-- transaction, where CONCURRENTLY is not allowed. At current table sizes each
-- build takes milliseconds; the brief SHARE lock blocks writes to that table
-- only while its index builds. Revisit (split into a non-transactional
-- CONCURRENTLY step) before a table grows to millions of rows.

-- CreateIndex
CREATE INDEX "ai_team_messages_clientId_idx" ON "ai_team_messages"("clientId");

-- CreateIndex
CREATE INDEX "ai_team_messages_projectId_idx" ON "ai_team_messages"("projectId");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE INDEX "approvals_projectId_idx" ON "approvals"("projectId");

-- CreateIndex
CREATE INDEX "ash_chat_messages_conversationId_idx" ON "ash_chat_messages"("conversationId");

-- CreateIndex
CREATE INDEX "assets_clientId_idx" ON "assets"("clientId");

-- CreateIndex
CREATE INDEX "chat_messages_parentId_idx" ON "chat_messages"("parentId");

-- CreateIndex
CREATE INDEX "chat_reactions_userId_idx" ON "chat_reactions"("userId");

-- CreateIndex
CREATE INDEX "client_email_mappings_clientId_idx" ON "client_email_mappings"("clientId");

-- CreateIndex
CREATE INDEX "client_invitations_clientId_idx" ON "client_invitations"("clientId");

-- CreateIndex
CREATE INDEX "contacts_clientId_idx" ON "contacts"("clientId");

-- CreateIndex
CREATE INDEX "creative_briefs_projectId_idx" ON "creative_briefs"("projectId");

-- CreateIndex
CREATE INDEX "email_triage_drafts_itemId_idx" ON "email_triage_drafts"("itemId");

-- CreateIndex
CREATE INDEX "event_attendees_userId_idx" ON "event_attendees"("userId");

-- CreateIndex
CREATE INDEX "intake_form_responses_formId_idx" ON "intake_form_responses"("formId");

-- CreateIndex
CREATE INDEX "intake_forms_clientId_idx" ON "intake_forms"("clientId");

-- CreateIndex
CREATE INDEX "internal_notes_threadId_idx" ON "internal_notes"("threadId");

-- CreateIndex
CREATE INDEX "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

-- CreateIndex
CREATE INDEX "invoice_payments_invoiceId_idx" ON "invoice_payments"("invoiceId");

-- CreateIndex
CREATE INDEX "messages_threadId_receivedAt_idx" ON "messages"("threadId", "receivedAt");

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "notes_parentId_idx" ON "notes"("parentId");

-- CreateIndex
CREATE INDEX "proposal_line_items_proposalId_idx" ON "proposal_line_items"("proposalId");

-- CreateIndex
CREATE INDEX "proposals_projectId_idx" ON "proposals"("projectId");

-- CreateIndex
CREATE INDEX "push_subscriptions_userId_idx" ON "push_subscriptions"("userId");

-- CreateIndex
CREATE INDEX "rate_cards_clientId_idx" ON "rate_cards"("clientId");

-- CreateIndex
CREATE INDEX "reports_clientId_idx" ON "reports"("clientId");

-- CreateIndex
CREATE INDEX "responses_threadId_idx" ON "responses"("threadId");

-- CreateIndex
CREATE INDEX "revenue_snapshots_clientId_idx" ON "revenue_snapshots"("clientId");

-- CreateIndex
CREATE INDEX "review_sessions_projectId_idx" ON "review_sessions"("projectId");

-- CreateIndex
CREATE INDEX "slack_channel_mappings_projectId_idx" ON "slack_channel_mappings"("projectId");

-- CreateIndex
CREATE INDEX "slack_import_records_projectId_idx" ON "slack_import_records"("projectId");

-- CreateIndex
CREATE INDEX "task_comments_taskId_idx" ON "task_comments"("taskId");

-- CreateIndex
CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");

-- CreateIndex
CREATE INDEX "time_entries_taskId_idx" ON "time_entries"("taskId");

-- CreateIndex
CREATE INDEX "time_sessions_taskId_idx" ON "time_sessions"("taskId");

-- CreateIndex
CREATE INDEX "wp_alerts_siteId_idx" ON "wp_alerts"("siteId");

-- CreateIndex
CREATE INDEX "wp_sites_clientId_idx" ON "wp_sites"("clientId");

-- The composite index above now serves every threadId lookup.
DROP INDEX "messages_threadId_idx";
