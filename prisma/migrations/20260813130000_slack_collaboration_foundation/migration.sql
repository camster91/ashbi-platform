-- Tenant-owned Slack installation, project channel mapping, and minimal
-- idempotency/audit receipts. Do not retain raw Slack message payloads here.
CREATE TABLE "slack_installations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT,
    "botUserId" TEXT,
    "botTokenEncrypted" TEXT,
    "scopes" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slack_channel_mappings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelName" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "outboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "slack_channel_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "slack_event_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "errorCode" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "slack_event_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slack_installations_teamId_key" ON "slack_installations"("teamId");
CREATE INDEX "slack_installations_organizationId_status_idx" ON "slack_installations"("organizationId", "status");
CREATE UNIQUE INDEX "slack_channel_mappings_installationId_channelId_key" ON "slack_channel_mappings"("installationId", "channelId");
CREATE INDEX "slack_channel_mappings_organizationId_projectId_idx" ON "slack_channel_mappings"("organizationId", "projectId");
CREATE UNIQUE INDEX "slack_event_receipts_eventId_key" ON "slack_event_receipts"("eventId");
CREATE INDEX "slack_event_receipts_organizationId_receivedAt_idx" ON "slack_event_receipts"("organizationId", "receivedAt");
CREATE INDEX "slack_event_receipts_installationId_channelId_idx" ON "slack_event_receipts"("installationId", "channelId");

ALTER TABLE "slack_installations" ADD CONSTRAINT "slack_installations_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_channel_mappings" ADD CONSTRAINT "slack_channel_mappings_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_channel_mappings" ADD CONSTRAINT "slack_channel_mappings_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "slack_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_channel_mappings" ADD CONSTRAINT "slack_channel_mappings_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_event_receipts" ADD CONSTRAINT "slack_event_receipts_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_event_receipts" ADD CONSTRAINT "slack_event_receipts_installationId_fkey"
  FOREIGN KEY ("installationId") REFERENCES "slack_installations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
