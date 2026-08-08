-- Stage WordPress bridge ownership before enforcing NOT NULL in a later,
-- audited migration. Rows that cannot be mapped remain NULL and are excluded
-- by tenant-scoped application reads.
ALTER TABLE "wp_sites" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "wp_sites" ADD COLUMN "bridgeSecretEncrypted" TEXT;
ALTER TABLE "wp_backups" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "wp_reports" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "wp_alerts" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "wp_fleet_ops" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "wp_magic_login_log" ADD COLUMN "organizationId" TEXT;
ALTER TABLE "support_hours" ADD COLUMN "organizationId" TEXT;

UPDATE "wp_sites" s SET "organizationId" = c."organizationId"
FROM "clients" c WHERE s."clientId" = c.id AND s."organizationId" IS NULL;
UPDATE "wp_sites" s SET "organizationId" = p."organizationId"
FROM "projects" p WHERE s."projectId" = p.id AND s."organizationId" IS NULL;

UPDATE "wp_backups" x SET "organizationId" = s."organizationId" FROM "wp_sites" s WHERE x."siteId" = s.id;
UPDATE "wp_reports" x SET "organizationId" = s."organizationId" FROM "wp_sites" s WHERE x."siteId" = s.id;
UPDATE "wp_alerts" x SET "organizationId" = s."organizationId" FROM "wp_sites" s WHERE x."siteId" = s.id;
UPDATE "wp_magic_login_log" x SET "organizationId" = s."organizationId" FROM "wp_sites" s WHERE x."siteId" = s.id;
UPDATE "support_hours" x SET "organizationId" = s."organizationId" FROM "wp_sites" s WHERE x."siteUrl" = s.url;
UPDATE "wp_fleet_ops" x SET "organizationId" = u."organizationId" FROM "users" u WHERE x."createdBy" = u.id;

CREATE TABLE "wp_bridge_nonces" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "siteId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wp_bridge_nonces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wp_sites_organizationId_idx" ON "wp_sites"("organizationId");
CREATE INDEX "wp_backups_organizationId_idx" ON "wp_backups"("organizationId");
CREATE INDEX "wp_reports_organizationId_idx" ON "wp_reports"("organizationId");
CREATE INDEX "wp_alerts_organizationId_idx" ON "wp_alerts"("organizationId");
CREATE INDEX "wp_fleet_ops_organizationId_idx" ON "wp_fleet_ops"("organizationId");
CREATE INDEX "wp_magic_login_log_organizationId_idx" ON "wp_magic_login_log"("organizationId");
CREATE INDEX "support_hours_organizationId_idx" ON "support_hours"("organizationId");
CREATE UNIQUE INDEX "wp_bridge_nonces_siteId_nonceHash_key" ON "wp_bridge_nonces"("siteId", "nonceHash");
CREATE INDEX "wp_bridge_nonces_organizationId_createdAt_idx" ON "wp_bridge_nonces"("organizationId", "createdAt");
CREATE INDEX "wp_bridge_nonces_createdAt_idx" ON "wp_bridge_nonces"("createdAt");

ALTER TABLE "wp_sites" ADD CONSTRAINT "wp_sites_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_backups" ADD CONSTRAINT "wp_backups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_reports" ADD CONSTRAINT "wp_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_alerts" ADD CONSTRAINT "wp_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_fleet_ops" ADD CONSTRAINT "wp_fleet_ops_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_magic_login_log" ADD CONSTRAINT "wp_magic_login_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_hours" ADD CONSTRAINT "support_hours_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wp_bridge_nonces" ADD CONSTRAINT "wp_bridge_nonces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wp_bridge_nonces" ADD CONSTRAINT "wp_bridge_nonces_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "wp_sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
