BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE gmail_ingest_receipts (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  mailbox TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "providerThreadId" TEXT NOT NULL,
  outcome TEXT NOT NULL,
  "clientId" TEXT,
  "threadId" TEXT,
  "messageId" TEXT,
  "triageItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT gmail_ingest_mailbox CHECK (length(mailbox) BETWEEN 3 AND 255 AND mailbox = lower(trim(mailbox)) AND mailbox ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  CONSTRAINT gmail_ingest_native_ids CHECK ("providerMessageId" ~ '^[A-Za-z0-9_-]{1,200}$' AND "providerThreadId" ~ '^[A-Za-z0-9_-]{1,200}$'),
  CONSTRAINT gmail_ingest_target CHECK (
    (outcome = 'MESSAGE' AND "clientId" IS NOT NULL AND "threadId" IS NOT NULL AND "messageId" IS NOT NULL AND "triageItemId" IS NULL)
    OR (outcome = 'TRIAGE' AND "clientId" IS NULL AND "threadId" IS NULL AND "messageId" IS NULL AND "triageItemId" IS NOT NULL)
    OR (outcome IN ('HELD_LEGACY_OVERLAP', 'HELD_MAPPING_CHANGE') AND "clientId" IS NULL AND "threadId" IS NULL AND "messageId" IS NULL AND "triageItemId" IS NULL)
  )
);
CREATE UNIQUE INDEX "gmail_ingest_receipts_organizationId_mailbox_providerMessag_key" ON gmail_ingest_receipts("organizationId",mailbox,"providerMessageId");
CREATE INDEX "gmail_ingest_receipts_organizationId_mailbox_providerThread_idx" ON gmail_ingest_receipts("organizationId",mailbox,"providerThreadId",outcome);

CREATE FUNCTION gmail_ingest_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Gmail ingestion receipts are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'DELETE' THEN
    -- Only organization teardown may remove replay evidence.
    IF EXISTS (SELECT 1 FROM organizations WHERE id=OLD."organizationId") THEN
      RAISE EXCEPTION 'Gmail ingestion receipts are retained' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.outcome = 'MESSAGE' AND NOT EXISTS (
    SELECT 1 FROM messages m JOIN threads t ON t.id=m."threadId" JOIN clients c ON c.id=t."clientId"
    LEFT JOIN projects p ON p.id=t."projectId"
    WHERE m.id=NEW."messageId" AND t.id=NEW."threadId" AND c.id=NEW."clientId"
      AND c."organizationId"=NEW."organizationId" AND c."deletedAt" IS NULL AND c.status IN ('ACTIVE','PROSPECT') AND c."relationshipStatus" NOT IN ('ARCHIVED','CHURNED')
      AND m.direction='INBOUND'
      AND (t."projectId" IS NULL OR (p."organizationId"=NEW."organizationId" AND p."clientId"=c.id AND p."deletedAt" IS NULL))
  ) THEN RAISE EXCEPTION 'Gmail ingestion message target is unavailable' USING ERRCODE='23514'; END IF;
  IF NEW.outcome = 'TRIAGE' AND NOT EXISTS (
    SELECT 1 FROM email_triage_items WHERE id=NEW."triageItemId" AND "organizationId"=NEW."organizationId"
  ) THEN RAISE EXCEPTION 'Gmail ingestion triage target is unavailable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gmail_ingest_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON gmail_ingest_receipts FOR EACH ROW EXECUTE FUNCTION gmail_ingest_receipt_guard();

COMMIT;
