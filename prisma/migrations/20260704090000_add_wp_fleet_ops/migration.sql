-- WP Bridge v1.8.0 — fleet ops orchestrator audit log (Plan 7)
--
-- Records every hub-side fan-out call (file/patch, command, option/set) so the
-- WPSites "Fleet Ops history" tab can show who ran what, when, and how many
-- sites succeeded. The payload column stores the original request body for
-- forensic reproduction; per-site results are intentionally NOT stored here
-- (they live in the wp_backups/wp_alerts tables that the plugin already writes
-- to) — this table is the hub-side book-keeping row only.

CREATE TABLE "wp_fleet_ops" (
  "id"            TEXT PRIMARY KEY,
  "opType"        TEXT NOT NULL,                -- 'file_patch' | 'command' | 'option_set'
  "payload"       JSONB NOT NULL,                -- original request body
  "targetCount"   INTEGER NOT NULL,
  "successCount"  INTEGER NOT NULL DEFAULT 0,
  "failureCount"  INTEGER NOT NULL DEFAULT 0,
  "createdBy"     TEXT NOT NULL,                -- user id from JWT
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3),
  CONSTRAINT "wp_fleet_ops_opType_check" CHECK ("opType" IN ('file_patch', 'command', 'option_set'))
);

CREATE INDEX "wp_fleet_ops_createdAt_idx" ON "wp_fleet_ops"("createdAt" DESC);
CREATE INDEX "wp_fleet_ops_opType_idx" ON "wp_fleet_ops"("opType");
CREATE INDEX "wp_fleet_ops_createdBy_idx" ON "wp_fleet_ops"("createdBy");