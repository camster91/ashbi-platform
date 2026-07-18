-- Reinstate the four wp_* tables that were dropped in
-- 20260629180000_drop_orphan_models. The plugin (camster91/ashbi-agency-wp-bridge)
-- has been posting to /api/wp-bridge/backup|/report|/alert since the strip-down
-- (commits 8613e81 + 691c69c) and receiving 404s because the route file and
-- models are gone. This migration recreates the exact tables that were dropped
-- (preserves the wp_sites/wp_backups/wp_reports/wp_alerts table names, all
-- columns, types, indexes, and unique constraints), so anyone running an
-- existing deployment gets the schema back without breaking any data that
-- happens to have been preserved.

CREATE TABLE "wp_sites" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "adminUrl" TEXT,
  "clientId" TEXT,
  "projectId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "wpVersion" TEXT,
  "phpVersion" TEXT,
  "pluginCount" INTEGER NOT NULL DEFAULT 0,
  "theme" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "healthScore" INTEGER NOT NULL DEFAULT 100,
  "alerts" TEXT NOT NULL DEFAULT '[]',
  "magicLoginUrl" TEXT,
  "bridgeVersion" TEXT,
  "ttfb" INTEGER,
  "dbSize" BIGINT,
  "diskBytes" BIGINT,
  "diskUsagePct" DOUBLE PRECISION,
  "pluginUpdates" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wp_sites_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE SET NULL,
  CONSTRAINT "wp_sites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "wp_sites_projectId_key" ON "wp_sites"("projectId");
CREATE INDEX "wp_sites_status_idx" ON "wp_sites"("status");

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
