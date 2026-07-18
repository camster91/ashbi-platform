-- WP Bridge v1.8.0 — extend wp_fleet_ops.opType CHECK to allow 'magic_login_revoke'
--
-- The CHECK constraint created in 20260704090000_add_wp_fleet_ops (and extended
-- in 20260705000001_extend_wp_fleet_ops_check_for_magic_login) only allows
-- ('file_patch', 'command', 'option_set', 'magic_login'). The
-- /api/wp-bridge/fleet/magic-login/revoke route (ManageWP-grade magic-login)
-- inserts opType = 'magic_login_revoke', which the old constraint rejects
-- with a 500. This migration drops the old CHECK and re-adds it with
-- magic_login_revoke included.
--
-- The constraint name ("wp_fleet_ops_opType_check") and column ("opType") are
-- preserved to keep the change a no-op for prisma migrate diff and for any
-- external tools that reference the constraint by name.

ALTER TABLE "wp_fleet_ops" DROP CONSTRAINT "wp_fleet_ops_opType_check";

ALTER TABLE "wp_fleet_ops" ADD CONSTRAINT "wp_fleet_ops_opType_check"
  CHECK ("opType" IN ('file_patch', 'command', 'option_set', 'magic_login', 'magic_login_revoke'));
