ALTER TABLE "invoice_payments"
  ADD COLUMN "settlementEvidenceStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "stripeChargeId" TEXT,
  ADD COLUMN "stripeBalanceTransactionId" TEXT,
  ADD COLUMN "settlementGrossMinor" INTEGER,
  ADD COLUMN "providerFeeMinor" INTEGER,
  ADD COLUMN "settlementNetMinor" INTEGER,
  ADD COLUMN "settlementCurrency" TEXT,
  ADD COLUMN "settlementReconciledAt" TIMESTAMP(3),
  ADD COLUMN "settlementReconciliationReason" TEXT,
  ADD CONSTRAINT "invoice_payment_settlement_status_supported" CHECK (
    "settlementEvidenceStatus" IN ('PENDING', 'VERIFIED', 'OUTCOME_UNKNOWN', 'REJECTED')
  ),
  ADD CONSTRAINT "invoice_payment_settlement_arithmetic" CHECK (
    "settlementEvidenceStatus" <> 'VERIFIED' OR (
      "settlementGrossMinor" IS NOT NULL AND "providerFeeMinor" IS NOT NULL
      AND "settlementNetMinor" IS NOT NULL AND "settlementCurrency" IS NOT NULL
      AND "settlementGrossMinor" - "providerFeeMinor" = "settlementNetMinor"
    )
  );

CREATE UNIQUE INDEX "invoice_payments_stripeBalanceTransactionId_key"
  ON "invoice_payments"("stripeBalanceTransactionId");

CREATE TABLE "invoice_settlement_events" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "paymentIntentId" TEXT NOT NULL,
  "stripeChargeId" TEXT,
  "stripeBalanceTransactionId" TEXT,
  "chargeAmountMinor" INTEGER,
  "chargeCurrency" TEXT,
  "settlementGrossMinor" INTEGER,
  "providerFeeMinor" INTEGER,
  "settlementNetMinor" INTEGER,
  "settlementCurrency" TEXT,
  "reasonCode" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_settlement_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_settlement_event_status_supported" CHECK (
    "status" IN ('PENDING', 'VERIFIED', 'OUTCOME_UNKNOWN', 'REJECTED')
  ),
  CONSTRAINT "invoice_settlement_event_arithmetic" CHECK (
    "status" <> 'VERIFIED' OR (
      "stripeBalanceTransactionId" IS NOT NULL AND "settlementGrossMinor" IS NOT NULL
      AND "providerFeeMinor" IS NOT NULL AND "settlementNetMinor" IS NOT NULL
      AND "settlementCurrency" IS NOT NULL
      AND "settlementGrossMinor" - "providerFeeMinor" = "settlementNetMinor"
    )
  ),
  CONSTRAINT "invoice_settlement_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_settlement_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "invoice_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "invoice_settlement_events_requestId_key" ON "invoice_settlement_events"("requestId");
CREATE INDEX "invoice_settlement_events_invoiceId_occurredAt_idx" ON "invoice_settlement_events"("invoiceId", "occurredAt");
CREATE INDEX "invoice_settlement_events_paymentId_occurredAt_idx" ON "invoice_settlement_events"("paymentId", "occurredAt");

CREATE OR REPLACE FUNCTION prevent_invoice_settlement_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice settlement event rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_settlement_events_append_only
BEFORE UPDATE OR DELETE ON "invoice_settlement_events"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_settlement_event_mutation();
