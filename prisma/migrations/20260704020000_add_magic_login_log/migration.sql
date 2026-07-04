-- WP Magic-Login audit log (Plan 11 / PR-F).
--
-- Per-state-transition record for magic-login activity on a WP site:
--   - issuance (hub → plugin request, got back a fresh token)
--   - consumption (admin clicked the magic URL, got logged in)
--   - revocation (hub kill-switch)
--   - rejection (expired token, replay attempt, IP-blocked, rate-limited)
--
-- Site URL is stored as a string (not a foreign key) so audit survives
-- WPSite deletes — important for incident postmortems. status + reason are
-- the primary filter axes for the WPSites "Recent Logins" tab.
--
-- tokenHash is the sha256 of the raw token — NEVER the raw token itself.
-- The plugin-side wp_options ring buffer stores the same hash so a single
-- incident can be cross-checked between plugin and hub without exposing
-- a replayable secret.

CREATE TABLE "wp_magic_login_log" (
  "id"          TEXT PRIMARY KEY,
  "siteId"      TEXT,
  "siteUrl"     TEXT NOT NULL,
  "userId"      INTEGER,
  "hubUserId"   TEXT,
  "ip"          TEXT NOT NULL DEFAULT '0.0.0.0',
  "status"      TEXT NOT NULL, -- 'issued' | 'consumed' | 'revoked' | 'rejected'
  "reason"      TEXT,        -- see comment above
  "tokenHash"   TEXT,        -- sha256 of the raw token, or NULL on rate-limit/IP rejections
  "ts"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wp_magic_login_log_status_check"
    CHECK ("status" IN ('issued', 'consumed', 'revoked', 'rejected'))
);

CREATE INDEX "wp_magic_login_log_siteId_idx"    ON "wp_magic_login_log"("siteId");
CREATE INDEX "wp_magic_login_log_siteUrl_idx"   ON "wp_magic_login_log"("siteUrl");
CREATE INDEX "wp_magic_login_log_ts_idx"        ON "wp_magic_login_log"("ts" DESC);
CREATE INDEX "wp_magic_login_log_status_idx"    ON "wp_magic_login_log"("status");
