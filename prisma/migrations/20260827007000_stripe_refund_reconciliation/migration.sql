ALTER TABLE "invoice_payments"
  ADD COLUMN "amountMinor" INTEGER,
  ADD COLUMN "currency" TEXT;

ALTER TABLE "invoice_payments"
  ADD CONSTRAINT "invoice_payments_currency_amount_evidence" CHECK (
    ("amountMinor" IS NULL AND "currency" IS NULL)
    OR ("amountMinor" > 0 AND "currency" IN ('CAD', 'USD'))
  );

CREATE TABLE "invoice_refunds" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "stripeRefundId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "signedStatus" TEXT NOT NULL,
  "failureReason" TEXT,
  "providerCreatedAt" TIMESTAMP(3) NOT NULL,
  "lastProviderEventAt" TIMESTAMP(3) NOT NULL,
  "lastStripeEventId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoice_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_refunds_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "invoice_refunds_currency_supported" CHECK ("currency" IN ('CAD', 'USD')),
  CONSTRAINT "invoice_refunds_status_supported" CHECK ("status" IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "invoice_refunds_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_refunds_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "invoice_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invoice_refunds_stripeRefundId_key"
  ON "invoice_refunds"("stripeRefundId");
CREATE INDEX "invoice_refunds_invoiceId_status_idx"
  ON "invoice_refunds"("invoiceId", "status");
CREATE INDEX "invoice_refunds_paymentId_status_idx"
  ON "invoice_refunds"("paymentId", "status");

CREATE TABLE "invoice_refund_events" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "stripeRefundId" TEXT NOT NULL,
  "stripeEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerEventAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_refund_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_refund_events_amount_positive" CHECK ("amountMinor" > 0),
  CONSTRAINT "invoice_refund_events_currency_supported" CHECK ("currency" IN ('CAD', 'USD')),
  CONSTRAINT "invoice_refund_events_status_supported" CHECK ("status" IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "invoice_refund_events_signed_status_supported" CHECK ("signedStatus" IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "invoice_refund_events_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_refund_events_refundId_fkey"
    FOREIGN KEY ("refundId") REFERENCES "invoice_refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invoice_refund_events_stripeEventId_key"
  ON "invoice_refund_events"("stripeEventId");
CREATE INDEX "invoice_refund_events_invoiceId_providerEventAt_idx"
  ON "invoice_refund_events"("invoiceId", "providerEventAt");
CREATE INDEX "invoice_refund_events_refundId_providerEventAt_idx"
  ON "invoice_refund_events"("refundId", "providerEventAt");

CREATE OR REPLACE FUNCTION prevent_invoice_refund_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice refund event rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_refund_events_append_only
BEFORE UPDATE OR DELETE ON "invoice_refund_events"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_refund_event_mutation();
