ALTER TABLE "invoice_delivery_attempts"
  ADD COLUMN "providerLifecycleStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "lastProviderEventAt" TIMESTAMP(3),
  ADD COLUMN "recipientServerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "temporaryFailureAt" TIMESTAMP(3),
  ADD COLUMN "permanentFailureAt" TIMESTAMP(3),
  ADD CONSTRAINT "invoice_delivery_attempt_provider_lifecycle_supported" CHECK (
    "providerLifecycleStatus" IN (
      'PENDING',
      'RECIPIENT_SERVER_ACCEPTED',
      'TEMPORARY_DELIVERY_FAILURE',
      'PERMANENT_DELIVERY_FAILURE'
    )
  );

ALTER TABLE "invoice_delivery_events"
  ADD COLUMN "providerEventId" TEXT,
  ADD COLUMN "providerEventKey" TEXT,
  ADD COLUMN "providerOccurredAt" TIMESTAMP(3);

ALTER TABLE "invoice_delivery_events"
  DROP CONSTRAINT "invoice_delivery_event_status_supported",
  ADD CONSTRAINT "invoice_delivery_event_status_supported" CHECK (
    "status" IN (
      'PREPARED',
      'PROVIDER_ACCEPTED',
      'FAILED',
      'OUTCOME_UNKNOWN',
      'CANCELED',
      'RECIPIENT_SERVER_ACCEPTED',
      'TEMPORARY_DELIVERY_FAILURE',
      'PERMANENT_DELIVERY_FAILURE'
    )
  );

CREATE UNIQUE INDEX "invoice_delivery_events_providerEventKey_key"
  ON "invoice_delivery_events"("providerEventKey");
CREATE INDEX "invoice_delivery_events_providerEventId_idx"
  ON "invoice_delivery_events"("providerEventId");

CREATE OR REPLACE FUNCTION prevent_invoice_delivery_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice delivery event rows are append-only';
END;
$$ LANGUAGE plpgsql;
