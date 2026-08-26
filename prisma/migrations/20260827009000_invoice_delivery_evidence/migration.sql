ALTER TABLE "invoices"
  ADD COLUMN "emailDeliveryAttempt" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "invoice_delivery_attempts" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "failureCode" TEXT,
  "requestedById" TEXT,
  "acceptedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "outcomeUnknownAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoice_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_delivery_attempt_status_supported" CHECK (
    "status" IN ('PREPARED', 'PROVIDER_ACCEPTED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELED')
  ),
  CONSTRAINT "invoice_delivery_attempt_kind_supported" CHECK (
    "kind" IN ('INITIAL', 'RESEND', 'REMINDER')
  ),
  CONSTRAINT "invoice_delivery_attempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "invoice_delivery_attempts_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invoice_delivery_attempts_requestId_key"
  ON "invoice_delivery_attempts"("requestId");
CREATE UNIQUE INDEX "invoice_delivery_attempts_invoiceId_attemptNumber_key"
  ON "invoice_delivery_attempts"("invoiceId", "attemptNumber");
CREATE INDEX "invoice_delivery_attempts_invoiceId_createdAt_idx"
  ON "invoice_delivery_attempts"("invoiceId", "createdAt");

CREATE TABLE "invoice_delivery_events" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "failureCode" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_delivery_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_delivery_event_status_supported" CHECK (
    "status" IN ('PREPARED', 'PROVIDER_ACCEPTED', 'FAILED', 'OUTCOME_UNKNOWN', 'CANCELED')
  ),
  CONSTRAINT "invoice_delivery_events_attemptId_fkey"
    FOREIGN KEY ("attemptId") REFERENCES "invoice_delivery_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_delivery_events_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "invoice_delivery_events_invoiceId_occurredAt_idx"
  ON "invoice_delivery_events"("invoiceId", "occurredAt");
CREATE INDEX "invoice_delivery_events_attemptId_occurredAt_idx"
  ON "invoice_delivery_events"("attemptId", "occurredAt");

CREATE OR REPLACE FUNCTION prevent_invoice_delivery_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice delivery event rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_delivery_events_append_only
BEFORE UPDATE OR DELETE ON "invoice_delivery_events"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_delivery_event_mutation();
