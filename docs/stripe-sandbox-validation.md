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
| Successful partial refund | A signed `refund.created` event retrieves the current refund, links it to the exact PaymentIntent-backed payment, records integer minor units and matching CAD/USD, and displays one staff-visible refund. |
| Refund replay and order | Replaying an event creates no duplicate. Delivering older refund events after newer ones retains every append-only event, uses current provider truth, and never moves the provider-event clock backwards. |
| Refund failure and limits | `refund.updated` and `refund.failed` update current state while preserving prior events. Currency/payment mismatches, legacy payments without exact evidence, and aggregate refunds above the payment amount fail closed without a ledger mutation. |
| Charge settlement evidence | As an administrator, reconcile each recorded Stripe payment through `POST /api/invoices/:invoiceId/payments/:paymentId/reconcile-settlement` with a unique `Idempotency-Key`. The PaymentIntent charge must match the recorded payment amount/currency; its expanded balance transaction must satisfy gross minus fee equals net. Payment currency and Stripe balance currency remain separate. |
| Settlement retry and uncertainty | Repeating the same reconciliation request performs no second provider read. A missing balance transaction remains `PENDING`; a provider read failure is `OUTCOME_UNKNOWN` with a safe reason; neither state reports zero fees. A later verified balance transaction cannot silently replace an already stored provider identity. |

## Required gap closure before a passing run

The provider-backed invalidation and refund-reconciliation boundaries are code-present locally but still need the sandbox evidence above. The complete provider lifecycle is not yet eligible to pass because:

- Complete the separate [invoice email sandbox runbook](invoice-email-sandbox-validation.md); provider acceptance is not inbox-delivery proof.
- Reconcile gross paid and successful refunds by payment currency, then reconcile verified charge gross, provider fees, and net charge settlement separately by Stripe balance currency. The local evidence path is code-present but still requires this sandbox proof; it must not infer fees, combine currencies, treat pending evidence as zero, or label collected cash as profit.
- Currency-safe reporting and export must reconcile invoice totals, payments, refunds, fees, and net settlement without combining CAD and USD.

Historical payment rows intentionally remain without inferred currency/minor-unit fields. Review and reconcile those rows from source evidence before using them in any refund test; do not backfill from defaults.

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
