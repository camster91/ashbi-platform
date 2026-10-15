-- CreateTable
CREATE TABLE "gmail_send_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISPATCHING',
    "providerMessageId" TEXT,
    "providerThreadId" TEXT,
    "hubMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "gmail_send_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gmail_send_receipts_userId_organizationId_idx" ON "gmail_send_receipts"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "gmail_send_receipts_organizationId_status_createdAt_idx" ON "gmail_send_receipts"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_send_receipts_organizationId_userId_idempotencyKey_key" ON "gmail_send_receipts"("organizationId", "userId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "gmail_send_receipts" ADD CONSTRAINT "gmail_send_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_send_receipts" ADD CONSTRAINT "gmail_send_receipts_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "users"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE gmail_send_receipts ADD CONSTRAINT gmail_receipt_shape CHECK (
  status IN ('DISPATCHING','ACCEPTED_PENDING_RECORD','COMPLETED','REJECTED','UNKNOWN')
  AND "idempotencyKey" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND "payloadHash" ~ '^[0-9a-f]{64}$'
  AND char_length(mailbox) BETWEEN 3 AND 255
  AND jsonb_typeof(snapshot) = 'object'
  AND snapshot ?& ARRAY['to','subject','body']
  AND jsonb_typeof(snapshot->'to') = 'string'
  AND jsonb_typeof(snapshot->'subject') = 'string'
  AND jsonb_typeof(snapshot->'body') = 'string'
  AND char_length(snapshot->>'to') BETWEEN 3 AND 255
  AND char_length(snapshot->>'subject') BETWEEN 1 AND 500
  AND char_length(snapshot->>'body') BETWEEN 1 AND 50000
  AND octet_length(snapshot::text) <= 300000
  AND (status NOT IN ('ACCEPTED_PENDING_RECORD','COMPLETED') OR ("providerMessageId" IS NOT NULL AND "providerThreadId" IS NOT NULL))
);
-- One approved draft can have only one potentially delivered attempt, even if
-- concurrent callers supply different intent keys. A definite rejection frees it.
CREATE UNIQUE INDEX gmail_receipt_approved_response_live_key
  ON gmail_send_receipts ("organizationId", (snapshot->>'responseId'))
  WHERE snapshot->>'responseId' IS NOT NULL AND status <> 'REJECTED';

CREATE FUNCTION ashbi_validate_gmail_send_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
      OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW.mailbox IS DISTINCT FROM OLD.mailbox
      OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'send receipt identity is immutable' USING ERRCODE = '23514';
    END IF;
    IF (OLD."providerMessageId" IS NOT NULL AND NEW."providerMessageId" IS DISTINCT FROM OLD."providerMessageId")
      OR (OLD."providerThreadId" IS NOT NULL AND NEW."providerThreadId" IS DISTINCT FROM OLD."providerThreadId")
      OR (OLD."hubMessageId" IS NOT NULL AND NEW."hubMessageId" IS DISTINCT FROM OLD."hubMessageId") THEN
      RAISE EXCEPTION 'send receipt outcome is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
      (OLD.status = 'DISPATCHING' AND NEW.status IN ('ACCEPTED_PENDING_RECORD','REJECTED','UNKNOWN'))
      OR (OLD.status = 'ACCEPTED_PENDING_RECORD' AND NEW.status = 'COMPLETED')) THEN
      RAISE EXCEPTION 'invalid send receipt transition' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.status <> 'DISPATCHING' OR NEW."providerMessageId" IS NOT NULL OR NEW."providerThreadId" IS NOT NULL OR NEW."hubMessageId" IS NOT NULL THEN
      RAISE EXCEPTION 'send receipt must begin before dispatch' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM users WHERE id = NEW."userId" AND "organizationId" = NEW."organizationId" AND "isActive" AND role IN ('ADMIN','TEAM') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'send receipt actor unavailable' USING ERRCODE = '23514'; END IF;
    IF NEW.snapshot->>'hubThreadId' IS NOT NULL THEN
      PERFORM 1 FROM threads t JOIN clients c ON c.id = t."clientId"
        WHERE t.id = NEW.snapshot->>'hubThreadId' AND c."organizationId" = NEW."organizationId" AND c."deletedAt" IS NULL FOR SHARE OF t,c;
      IF NOT FOUND THEN RAISE EXCEPTION 'send receipt thread unavailable' USING ERRCODE = '23514'; END IF;
    END IF;
    IF NEW.snapshot->>'responseId' IS NOT NULL THEN
      PERFORM 1 FROM responses r WHERE r.id = NEW.snapshot->>'responseId' AND r."threadId" = NEW.snapshot->>'hubThreadId' AND r.status = 'APPROVED' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'send receipt response unavailable' USING ERRCODE = '23514'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER gmail_receipt_scope BEFORE INSERT OR UPDATE ON gmail_send_receipts FOR EACH ROW EXECUTE FUNCTION ashbi_validate_gmail_send_receipt();
