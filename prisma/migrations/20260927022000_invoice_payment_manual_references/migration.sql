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
-- Both statements run in the migration's single implicit transaction, so
-- the index build's SHARE lock (blocking payment inserts) is held until
-- commit; invoice_payments is small, so the window is short.
CREATE UNIQUE INDEX "invoice_payments_stripe_transactionId_key"
  ON "invoice_payments"("transactionId") WHERE (method = 'STRIPE');

DROP INDEX "invoice_payments_transactionId_key";
