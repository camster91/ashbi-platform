-- Replay guard for the signed inbound email webhook (POST /api/webhooks/email):
-- the signature of each accepted delivery is recorded once.
--
-- Additive only: one new table and its indexes. Rolling back the image is safe
-- (older code never reads it).
--
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction, so
-- the explicit BEGIN/COMMIT makes the table and its indexes all-or-nothing (a
-- replay guard without its unique index would accept replays). The table is
-- new, so the lock_timeout only guards against an unexpected catalog lock wait.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateTable
CREATE TABLE "email_webhook_receipts" (
    "id" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_webhook_receipts_signature_key" ON "email_webhook_receipts"("signature");

-- CreateIndex
CREATE INDEX "email_webhook_receipts_receivedAt_idx" ON "email_webhook_receipts"("receivedAt");

COMMIT;
