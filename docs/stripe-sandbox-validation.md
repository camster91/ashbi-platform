# Stripe sandbox validation

Status: Runbook ready; no Stripe sandbox, key, webhook, migration, or payment was changed by this work

## Purpose

Prove the Hub can replace Bonsai's payment path without guessing currency or tax, duplicating checkout attempts, trusting browser redirects, or losing provider evidence. This runbook is test mode only. Passing it does not authorize live keys, live charges, tax configuration, refunds, deployment, or Bonsai cutover.

## Preconditions

1. Use a dedicated Stripe sandbox and an authorized synthetic Ashbi client; never use a real client or live-mode key.
2. Back up the target database and record the revision and rollback procedure.
3. Review and apply the committed Hub migrations in that sandbox, including `stripeCheckoutAttempt`.
4. Put a test-mode restricted key (`rk_`) and the sandbox webhook signing secret in the deployment secret vault. Do not commit, paste into chat, or log either value.
5. Point the webhook only at `POST /api/webhooks/stripe`. The removed `/api/invoices/stripe-webhook` path must remain unavailable.
6. Confirm the sandbox `APP_URL`, invoice portal URL, tenant, test client, and staff account.
7. Keep Stripe automatic tax disabled. A tax advisor/business decision and confirmed active registrations are separate prerequisites before any future automatic-tax work.

## Checkout cases

Use separate authorized CAD and USD invoices with reviewed tax evidence.

| Case | Required evidence |
| --- | --- |
| First checkout | Invoice is `SENT`, total is positive, public access is active, Stripe returns a hosted Checkout URL, and the stored session ID/currency/minor amount match. |
| Exact replay | Repeating checkout for the same active attempt returns the same Stripe session and creates no second Hub payment. |
| Concurrent replay | Two simultaneous requests resolve to one Stripe session and one persisted active attempt. |
| Expiry | A signed `checkout.session.expired` event clears only that active session, increments the attempt once, and a later request creates one different session. |
| Revoke/rotate/void | Public access is shielded before the exact active session is expired. The local action finalizes only after confirmation, advances the attempt once, and stores append-only audit evidence. Rotation exposes the new token only after confirmation. |
| Invalidation race | A completed session or unknown provider response leaves the invoice payable state intact, keeps the session for investigation, blocks public access, and records a reconciliation-required audit without leaking provider error details. A later verified payment clears the reconciliation flag. |
| Delayed method | An unpaid completion leaves the invoice `SENT`; signed delayed success records one payment; signed delayed failure clears only the active attempt. |
| Mismatch denial | Bad signature, stale session ID, wrong invoice number, amount, or currency does not change invoice or ledger state. |
| Voided invoice | A late completion cannot change a `VOID` invoice to `PAID`; the incident is retained for reconciliation. |
| Duplicate delivery | Replaying the same verified success event returns success to Stripe but leaves exactly one payment row and one paid transition. |
| Redirect | Success/cancel URLs contain the exact persisted public token and a browser redirect alone never marks an invoice paid. |

## Required gap closure before a passing run

The provider-backed invalidation boundary is code-present locally but still needs the sandbox evidence above. The complete provider lifecycle is not yet eligible to pass because:

- Successful and partial refunds need a signed-event reconciliation path and durable currency-safe ledger representation.
- Invoice email acceptance/failure must have truthful delivery state and retry evidence.
- Currency-safe reporting and export must reconcile invoice totals, payments, refunds, fees, and net settlement without combining CAD and USD.

These are engineering gates, not sandbox exceptions. Do not mark the runbook passed by skipping them.

## Reconciliation package

Retain a redacted evidence package containing:

- Hub revision and applied migration list.
- Stripe sandbox identifier and API version, but no keys or secrets.
- Test invoice IDs, currencies, totals, checkout attempt numbers, session IDs, event IDs, and payment transaction IDs.
- Request/event timestamps and expected versus actual state transitions.
- Duplicate, mismatch, delayed, expiry, revoke/void, refund, and recovery results.
- Hub export checksum, Stripe sandbox export, and a line-by-line reconciliation report.
- Database backup reference and an isolated restore result.

## Pass condition

Every case passes without manual database correction; CAD and USD reconcile separately; no real client is contacted or charged; backup/restore succeeds; and the remaining Bonsai parallel-run and Cameron financial-cutover gates stay intact.
