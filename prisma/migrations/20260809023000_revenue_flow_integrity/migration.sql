-- Expiring, revocable public document access.
ALTER TABLE "proposals"
  ADD COLUMN "publicAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "publicAccessRevokedAt" TIMESTAMP(3);

ALTER TABLE "contracts"
  ADD COLUMN "publicAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "publicAccessRevokedAt" TIMESTAMP(3),
  ADD COLUMN "signedContentHash" TEXT,
  ADD COLUMN "signatureType" TEXT,
  ADD COLUMN "signatureDataHash" TEXT,
  ADD COLUMN "signerIp" TEXT,
  ADD COLUMN "signerUserAgent" TEXT;

ALTER TABLE "invoices"
  ADD COLUMN "stripeCheckoutSessionId" TEXT,
  ADD COLUMN "publicAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "publicAccessRevokedAt" TIMESTAMP(3);

UPDATE "proposals"
SET "publicAccessExpiresAt" = LEAST(COALESCE("validUntil", NOW() + INTERVAL '30 days'), NOW() + INTERVAL '30 days')
WHERE status IN ('SENT', 'VIEWED');
UPDATE "proposals" SET "publicAccessRevokedAt" = NOW() WHERE status IN ('APPROVED', 'DECLINED');

UPDATE "contracts" SET "publicAccessExpiresAt" = NOW() + INTERVAL '30 days' WHERE status = 'SENT';
UPDATE "contracts" SET "publicAccessRevokedAt" = NOW() WHERE status IN ('SIGNED', 'VOID');

UPDATE "invoices" SET "publicAccessExpiresAt" = NOW() + INTERVAL '30 days' WHERE status IN ('SENT', 'PAID');
UPDATE "invoices" SET "publicAccessRevokedAt" = NOW() WHERE status = 'VOID';

-- Stripe payment intent IDs are globally unique. Existing duplicates are
-- retained by clearing all but their earliest record before adding the guard.
WITH duplicates AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "transactionId" ORDER BY "createdAt", id) AS row_number
  FROM "invoice_payments"
  WHERE "transactionId" IS NOT NULL
)
UPDATE "invoice_payments" AS payment
SET "transactionId" = NULL,
    notes = CONCAT_WS(' | ', payment.notes, 'Duplicate transaction reference removed during integrity migration')
FROM duplicates
WHERE payment.id = duplicates.id
  AND duplicates.row_number > 1;

CREATE UNIQUE INDEX "invoice_payments_transactionId_key"
  ON "invoice_payments"("transactionId");
