-- Organization-level MFA enforcement (#416 follow-up; docs/privileged-actions.md,
-- "Organization MFA requirement"). An organization administrator can require
-- every active staff member to use two-factor authentication. While it is on,
-- a staff session without two-factor can reach only the enrollment endpoints
-- (src/auth/mfa-enforcement.js).
--
-- Additive only: one NOT NULL column with a constant default, which
-- PostgreSQL 11+ adds as a catalog-only change (no table rewrite). Every
-- existing organization gets mfaRequired = false, so nothing changes until an
-- administrator turns it on. Rolling back the application image is safe:
-- older code never reads the column (but note that an older image does not
-- enforce the requirement either).
--
-- Locking: ALTER TABLE takes an ACCESS EXCLUSIVE lock on "organizations"
-- briefly. Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT keeps it all-or-nothing, and lock_timeout makes
-- the deploy fail fast and roll back cleanly instead of queueing every
-- request behind a long-running transaction; rerun it when the database is
-- quieter.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
