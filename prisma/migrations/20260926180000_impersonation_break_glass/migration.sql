-- Audited support impersonation and break-glass administrator recovery (#416).
-- Policy and runbook: docs/privileged-actions.md.
--
-- Actor, subject, target and operator user ids deliberately carry no foreign
-- key (like audit_events.actorUserId and review_share_links.createdById):
-- these rows are evidence and must outlive the accounts they name, so a user
-- deletion can neither cascade them away nor be blocked by them. The
-- organization FK cascades because the whole tenant's records go with it.

-- CreateTable
CREATE TABLE "impersonation_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "subjectRole" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "readOnly" BOOLEAN NOT NULL DEFAULT true,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "endedById" TEXT,

    CONSTRAINT "impersonation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "promoteToAdmin" BOOLEAN NOT NULL DEFAULT false,
    "tokenHash" TEXT NOT NULL,
    "issuedByOsUser" TEXT NOT NULL,
    "issuedFromHost" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "break_glass_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "impersonation_sessions_organizationId_startedAt_idx" ON "impersonation_sessions"("organizationId", "startedAt");

-- CreateIndex
CREATE INDEX "impersonation_sessions_actorUserId_endedAt_idx" ON "impersonation_sessions"("actorUserId", "endedAt");

-- CreateIndex
CREATE INDEX "impersonation_sessions_subjectUserId_endedAt_idx" ON "impersonation_sessions"("subjectUserId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "break_glass_grants_tokenHash_key" ON "break_glass_grants"("tokenHash");

-- CreateIndex
CREATE INDEX "break_glass_grants_organizationId_createdAt_idx" ON "break_glass_grants"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Closed vocabularies and bounds. Prisma does not model CHECK constraints;
-- the application enforces the same rules (src/auth/impersonation.js,
-- src/auth/break-glass.js) and these keep a buggy or hand-written write out.
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_subjectRole_check"
  CHECK ("subjectRole" IN ('TEAM', 'STAFF', 'CLIENT'));
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_reason_check"
  CHECK (length("reason") BETWEEN 10 AND 500);
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_not_self_check"
  CHECK ("actorUserId" <> "subjectUserId");
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_expiry_check"
  CHECK ("expiresAt" > "startedAt" AND "expiresAt" <= "startedAt" + INTERVAL '60 minutes');
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_end_check"
  CHECK (("endedAt" IS NULL) = ("endReason" IS NULL));
ALTER TABLE "impersonation_sessions" ADD CONSTRAINT "impersonation_sessions_endReason_check"
  CHECK ("endReason" IS NULL OR "endReason" IN (
    'stopped', 'expired', 'superseded', 'signed_out',
    'revoked_password_reset', 'revoked_role_change', 'revoked_deactivated', 'revoked_password_change',
    'start_failed'
  ));

ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_reason_check"
  CHECK (length("reason") BETWEEN 10 AND 500);
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_expiry_check"
  CHECK ("expiresAt" > "createdAt" AND "expiresAt" <= "createdAt" + INTERVAL '60 minutes');
ALTER TABLE "break_glass_grants" ADD CONSTRAINT "break_glass_grants_single_outcome_check"
  CHECK ("redeemedAt" IS NULL OR "revokedAt" IS NULL);
