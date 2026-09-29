-- Payment references: only Stripe transaction ids are unique.
--
-- invoice_payments.transactionId was globally unique, so recording a manual
-- bank/cheque reference that a client reused on a second invoice failed.
-- Stripe ids must stay unique (webhook replay protection), manual
-- references need not.
--
-- Live-DB safety: the partial index covers a subset of rows that were
-- already globally unique, so it cannot fail on existing data; it is built
-- before the global index is dropped, so Stripe uniqueness never lapses.
-- Atomicity: Prisma does not wrap a PostgreSQL migration in a transaction,
-- so the body is an explicit BEGIN/COMMIT: a failure part-way (for example
-- the lock timeout) rolls everything back and the deploy can simply be
-- rerun. lock_timeout (SET LOCAL, this transaction only) makes the migration
-- fail fast instead of queueing behind a long transaction and stalling the
-- writers queued behind it; rerun the deploy when the database is quieter.
-- The index build's SHARE lock (blocking payment inserts) is held until
-- COMMIT; invoice_payments is small, so the window is short.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX "invoice_payments_stripe_transactionId_key"
  ON "invoice_payments"("transactionId") WHERE (method = 'STRIPE');

DROP INDEX "invoice_payments_transactionId_key";

COMMIT;
