-- Append-only, tenant-scoped audit event log (issue #412).
-- Additive only: a new table, indexes, constraints and triggers. No existing
-- table or row is touched, so rolling back the application image is safe.

CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "requestId" TEXT,
    "ip" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"),
    -- Prisma does not model CHECK constraints; they are enforced here only.
    CONSTRAINT "audit_events_actorType_check"
      CHECK ("actorType" IN ('USER', 'CLIENT', 'SYSTEM', 'WEBHOOK', 'BOT')),
    CONSTRAINT "audit_events_action_format_check"
      CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length("action") <= 100),
    CONSTRAINT "audit_events_metadata_object_check"
      CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE INDEX "audit_events_organizationId_createdAt_id_idx" ON "audit_events"("organizationId", "createdAt", "id");
CREATE INDEX "audit_events_organizationId_entityType_entityId_createdAt_idx" ON "audit_events"("organizationId", "entityType", "entityId", "createdAt");
CREATE INDEX "audit_events_organizationId_action_createdAt_idx" ON "audit_events"("organizationId", "action", "createdAt");
CREATE INDEX "audit_events_organizationId_actorUserId_createdAt_idx" ON "audit_events"("organizationId", "actorUserId", "createdAt");

-- RESTRICT: an organization with audit history cannot be hard-deleted and
-- silently take its evidence with it (retention is decided in #310).
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit events are append-only even for database roles with table write
-- access. The row trigger covers UPDATE/DELETE; the statement trigger covers
-- TRUNCATE, which bypasses row triggers.
CREATE OR REPLACE FUNCTION deny_audit_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit events are append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION deny_audit_event_mutation();

CREATE TRIGGER audit_events_no_truncate
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION deny_audit_event_mutation();
