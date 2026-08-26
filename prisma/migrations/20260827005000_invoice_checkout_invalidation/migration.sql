ALTER TABLE "invoices"
  ADD COLUMN "stripeCheckoutReconciliationRequiredAt" TIMESTAMP(3),
  ADD COLUMN "stripeCheckoutReconciliationReason" TEXT;

CREATE TABLE "invoice_checkout_audits" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "checkoutSessionId" TEXT,
  "checkoutAttempt" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "providerStatus" TEXT,
  "reasonCode" TEXT,
  "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_checkout_audits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_checkout_audits_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "invoice_checkout_audits_invoiceId_createdAt_idx"
  ON "invoice_checkout_audits"("invoiceId", "createdAt");
CREATE INDEX "invoice_checkout_audits_outcome_createdAt_idx"
  ON "invoice_checkout_audits"("outcome", "createdAt");

CREATE OR REPLACE FUNCTION prevent_invoice_checkout_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Invoice checkout audit rows are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_checkout_audits_append_only
BEFORE UPDATE OR DELETE ON "invoice_checkout_audits"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_checkout_audit_mutation();
