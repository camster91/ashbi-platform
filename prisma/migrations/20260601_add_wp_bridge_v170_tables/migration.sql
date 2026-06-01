-- WP Bridge v1.7.0 maintenance features: backups, reports, alerts, support hours
-- Adds 4 new tables + 5 new columns on wp_sites

ALTER TABLE "wp_sites"
  ADD COLUMN "bridgeVersion" TEXT,
  ADD COLUMN "ttfb" INTEGER,
  ADD COLUMN "dbSize" BIGINT,
  ADD COLUMN "diskUsage" BIGINT,
  ADD COLUMN "pluginUpdates" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "wp_backups" (
  "id" TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "dbSuccess" BOOLEAN NOT NULL,
  "filesSuccess" BOOLEAN NOT NULL,
  "dbFile" TEXT,
  "filesFile" TEXT,
  "manifest" TEXT,
  "dbSize" BIGINT,
  "filesSize" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wp_backups_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE
);

CREATE INDEX "wp_backups_siteId_idx" ON "wp_backups"("siteId");
CREATE INDEX "wp_backups_siteUrl_idx" ON "wp_backups"("siteUrl");
CREATE INDEX "wp_backups_timestamp_idx" ON "wp_backups"("timestamp");

CREATE TABLE "wp_reports" (
  "id" TEXT PRIMARY KEY,
  "siteId" TEXT NOT NULL,
  "siteUrl" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "uptime" TEXT,
  "updates" TEXT,
  "cleanup" TEXT,
  "hours" TEXT,
  "ssl" TEXT,
  "payload" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wp_reports_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "wp_reports_siteId_month_key" ON "wp_reports"("siteId", "month");
CREATE INDEX "wp_reports_siteUrl_idx" ON "wp_reports"("siteUrl");
CREATE INDEX "wp_reports_createdAt_idx" ON "wp_reports"("createdAt");

CREATE TABLE "wp_alerts" (
  "id" TEXT PRIMARY KEY,
  "siteId" TEXT,
  "siteUrl" TEXT NOT NULL,
  "alertType" TEXT NOT NULL,
  "details" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wp_alerts_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE SET NULL
);

CREATE INDEX "wp_alerts_siteUrl_idx" ON "wp_alerts"("siteUrl");
CREATE INDEX "wp_alerts_alertType_idx" ON "wp_alerts"("alertType");
CREATE INDEX "wp_alerts_createdAt_idx" ON "wp_alerts"("createdAt");

CREATE TABLE "support_hours" (
  "id" TEXT PRIMARY KEY,
  "siteUrl" TEXT NOT NULL,
  "clientId" TEXT,
  "projectId" TEXT,
  "month" TEXT NOT NULL,
  "hours" DOUBLE PRECISION NOT NULL,
  "description" TEXT,
  "source" TEXT NOT NULL DEFAULT 'plugin',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "support_hours_siteUrl_idx" ON "support_hours"("siteUrl");
CREATE INDEX "support_hours_month_idx" ON "support_hours"("month");
CREATE INDEX "support_hours_clientId_idx" ON "support_hours"("clientId");
