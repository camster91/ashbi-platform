-- Transactional outbox of domain events (#412, docs/event-outbox.md).
--
-- Additive only: one new table, its indexes, constraints and a trigger. No
-- existing table or row is touched, so rolling back the application image is
-- safe (the old code never reads this table; pending rows simply wait).

-- CreateTable
CREATE TABLE "domain_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "claimToken" TEXT,
    "publishedAt" TIMESTAMP(3),
    "discardedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "replayCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id"),
    -- Prisma does not model CHECK constraints; they are enforced here only.
    CONSTRAINT "domain_events_type_format_check"
      CHECK ("type" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length("type") <= 100),
    CONSTRAINT "domain_events_status_check"
      CHECK ("status" IN ('pending', 'dispatching', 'published', 'dead', 'discarded')),
    CONSTRAINT "domain_events_schemaVersion_check" CHECK ("schemaVersion" >= 1),
    CONSTRAINT "domain_events_sequence_check" CHECK ("sequence" >= 1),
    CONSTRAINT "domain_events_attempts_check" CHECK ("attempts" >= 0),
    CONSTRAINT "domain_events_replayCount_check" CHECK ("replayCount" >= 0),
    CONSTRAINT "domain_events_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "domain_events_field_length_check" CHECK (
      length("aggregateType") BETWEEN 1 AND 64
      AND length("aggregateId") BETWEEN 1 AND 191
      AND length("correlationId") BETWEEN 1 AND 191
      AND ("causationId" IS NULL OR length("causationId") BETWEEN 1 AND 191)
      AND length("idempotencyKey") BETWEEN 1 AND 255
      AND ("lastError" IS NULL OR length("lastError") <= 500)
    ),
    -- Bookkeeping must stay consistent with the status it describes.
    CONSTRAINT "domain_events_published_at_check"
      CHECK ("status" <> 'published' OR "publishedAt" IS NOT NULL),
    CONSTRAINT "domain_events_discarded_at_check"
      CHECK ("status" <> 'discarded' OR "discardedAt" IS NOT NULL),
    CONSTRAINT "domain_events_claim_check"
      CHECK ("status" <> 'dispatching' OR ("lockedUntil" IS NOT NULL AND "claimToken" IS NOT NULL))
);

-- CreateIndex
CREATE INDEX "domain_events_status_nextAttemptAt_idx" ON "domain_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "domain_events_organizationId_status_occurredAt_idx" ON "domain_events"("organizationId", "status", "occurredAt");

-- CreateIndex
CREATE INDEX "domain_events_organizationId_type_occurredAt_idx" ON "domain_events"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_organizationId_idempotencyKey_key" ON "domain_events"("organizationId", "idempotencyKey");

-- CreateIndex: per-aggregate ordering, also used by the dispatcher's
-- "no unpublished predecessor" check.
CREATE UNIQUE INDEX "domain_events_organizationId_aggregateType_aggregateId_sequ_key" ON "domain_events"("organizationId", "aggregateType", "aggregateId", "sequence");

-- AddForeignKey. ON DELETE CASCADE: outbox rows are delivery state, not
-- evidence (the append-only audit_events table is the evidence trail), so
-- they go with their organization. Retention of published rows is decided in
-- #310. ON UPDATE RESTRICT: organizationId is part of the immutable envelope
-- (see the trigger below), so an organization id change is refused rather
-- than cascaded into a trigger error.
ALTER TABLE "domain_events" ADD CONSTRAINT "domain_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- The event envelope is immutable once written, for every database role with
-- table write access. Only the dispatch bookkeeping columns may change.
CREATE OR REPLACE FUNCTION deny_domain_event_envelope_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."type" IS DISTINCT FROM OLD."type"
     OR NEW."schemaVersion" IS DISTINCT FROM OLD."schemaVersion"
     OR NEW."aggregateType" IS DISTINCT FROM OLD."aggregateType"
     OR NEW."aggregateId" IS DISTINCT FROM OLD."aggregateId"
     OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
     OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."correlationId" IS DISTINCT FROM OLD."correlationId"
     OR NEW."causationId" IS DISTINCT FROM OLD."causationId"
     OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
     OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt" THEN
    RAISE EXCEPTION 'domain event envelope is immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER domain_events_envelope_immutable
BEFORE UPDATE ON "domain_events"
FOR EACH ROW EXECUTE FUNCTION deny_domain_event_envelope_change();
