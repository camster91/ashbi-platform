# Stripe settlement evidence

## Purpose

Show provider fees and net settlement only when the hub has retrieved and reconciled Stripe's balance-transaction evidence. Customer payment currency remains separate from Stripe settlement currency.

## Evidence states

- `PENDING`: payment is recorded, but the charge has no expanded balance transaction yet. Retry is safe with a new request ID.
- `VERIFIED`: charge amount/currency match the recorded payment and `gross - fee = net` for the balance transaction.
- `OUTCOME_UNKNOWN`: Stripe could not be read. The safe reason code is stored without provider error text.
- `REJECTED`: reserved for evidence that fails validation; no figures may be reported as verified.

Every reconciliation request creates an append-only event. Repeating the same request ID is idempotent and does not read Stripe again.

## Operator procedure

1. Use Stripe test mode and a dedicated non-production database.
2. Complete an invoice Checkout payment and confirm the payment webhook records the exact payment amount and currency.
3. As an administrator, call `POST /api/invoices/:invoiceId/payments/:paymentId/reconcile-settlement` with a unique `Idempotency-Key`.
4. Confirm the response is `VERIFIED` or `PENDING`. Never treat `OUTCOME_UNKNOWN` as zero fees.
5. Confirm Collections shows customer collections by payment currency and fees/net settlement by Stripe balance currency.
6. Repeat after a refund and verify the refund ledger separately; charge balance transactions do not include later refund or dispute effects.

## Cutover boundary

This migration and endpoint must not be applied to production, nor called against live Stripe, until Cameron explicitly approves the exact migration and test/live Stripe operation at action time.
