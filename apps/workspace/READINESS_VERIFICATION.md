# Readiness verification

This file records a bounded local assessment of the release gaps identified in `PRODUCT_EXPECTATIONS.md`. It is evidence for implementation review; it is not a production acceptance record, a PCI or ASVS certification, a field Core Web Vitals baseline, or authorization to send email, send push notifications, charge cards, or enable live Stripe mode.

## Security scope

`readiness-verification.test.mjs` exercises the native-auth Worker with an isolated Miniflare D1 database. The matrix checks unauthenticated rejection, same-origin enforcement for JSON mutations, organization filtering, client denial of staff and finance routes, and that a foreign organization's project is absent from staff and client responses. Existing route suites provide deeper record-level checks, including project visibility, active identity rechecks, private file access and exact finance authority. The relevant suites are `test.mjs`, `files.test.mjs`, `inbox.test.mjs`, `stripe-drafts.test.mjs`, `stripe-lifecycle.test.mjs`, and `recovery.test.mjs`.

This is a scoped authorization review of the changed Cloudflare Worker boundary. It does not establish a complete OWASP ASVS assessment, browser extension model, origin infrastructure review, D1/R2 administrative review, or production penetration test. A follow-up security review should cover the deployed account configuration, secret rotation, Cloudflare route policy, dependency advisories and authenticated owner journeys.

## Billing sandbox

The test creates a synthetic finance actor and uses the repository's `stripeTestProvider` contract fixture. It confirms that an explicitly disabled provider reports `configured:false` and makes zero provider requests, while live/unconfigured settings fail closed with `503` before a provider call. The existing Stripe draft, lifecycle, delivery, issuance and installment suites cover reviewed previews, exact money, idempotency, lost acknowledgements, reconciliation, webhook processing, access revocation and provider mismatch behavior against isolated fixtures.

No real Stripe account, test charge, invoice email, payment method, webhook endpoint or customer record is touched by this verification. Production remains test-mode and requires a separately reviewed provider-backed sandbox journey before any live activation.

### Manual provider-backed sandbox acceptance checklist

This is the next operator checklist, not completed evidence. Run only against a dedicated Stripe test account with synthetic records and a test webhook secret. Keep the provider secret in the deployment secret store or local environment; never paste it into logs, fixtures or this document.

1. Confirm `STRIPE_MODE=test`, the intended organization and account IDs, a test secret, and a test webhook secret. Capture the redacted configuration and account ID; reject live-mode keys.
2. Create a synthetic client/project and finance actor. `POST /api/invoices/preview` and `POST /api/invoices` must leave the local invoice `status=DRAFT`, `provider_state=NOT_CONNECTED`, `paid_minor=0`, and return a stable preview fingerprint.
3. `POST /api/invoices/:id/stripe-preview` must return an exact reviewed plan with `autoAdvance=false`, `sendsMessage=false`, `chargesPayment=false`, the expected currency/minor-unit total, and no provider write.
4. Submit `POST /api/invoices/:id/stripe` with the stored revision, fingerprint, a fresh request ID and a human reason. Record the provider request paths, redacted idempotency keys, status codes and request IDs. The successful terminal state is operation `state=DONE`, `stage=DONE`, and invoice `provider_state=DRAFT` with a provider invoice ID; the provider invoice remains an unissued draft.
5. Repeat the exact request. It must return the existing operation without a second provider invoice. Change the request ID, revision, fingerprint or reason one at a time and confirm the request is rejected without widening access or changing the claimed invoice.
6. Rehearse a lost provider acknowledgement using the existing `stripeTestProvider` fault controls or an isolated test proxy. The first call should persist `state=UNKNOWN`/`provider_state=UNKNOWN` (HTTP 202), and `POST /api/invoices/:id/stripe/reconcile` must read the exact provider record and reach `DONE` without creating a duplicate or replaying a new idempotency key. An expired uncertain write must become `REVIEW_REQUIRED` and require an explicit exact-record adoption decision.
7. Send a signed test webhook through `POST /api/stripe/webhook`. The intake response should be `202`/`received:true` without provider writes. Run the scheduled drain; `GET /api/stripe/events/:eventId` must move from `PENDING`/`RETRY` to `APPLIED`, with the invoice projection matching the provider snapshot. A bad signature, wrong account, foreign organization or duplicate event must be rejected or idempotently ignored.
8. Capture local response bodies with secrets, customer emails, payment methods and full provider payloads removed; database state before/after; provider dashboard test-mode links; and the exact Worker release. The acceptance owner records pass/fail per step and keeps the evidence with the release, separate from production owner acceptance.

The existing `stripeTestProvider` harness exercises these transitions without contacting Stripe. It is useful for regression and fault injection, but it does not complete this provider-backed checklist. No test transaction, invoice email, payment or live-mode activation is authorized by this document.

## Performance diagnostic

The test seeds 150 synthetic project messages, 20 assigned/due tasks, and read receipts for 20 of those events. It measures six local task reads, four Inbox summary reads, and walks the unread Inbox through bounded pages of 50. It asserts the exact 170 unread event IDs and page sizes (`50,50,50,20`), so the diagnostic includes message, assignment and deadline query paths rather than an empty Inbox. It records timings but intentionally has no wall-clock pass/fail threshold in shared CI. These are lab timings from a warm local D1 process; they do not represent Cloudflare edge latency, browser LCP/INP/CLS, network transfer, cache behavior, or p75 field data.

The 29 October 2026 source run passed 3/3. Its six task reads measured 19.1, 17.7, 16.9, 17.9, 17.9 and 17.8 ms (p95 19.1 ms); four Inbox summary reads measured 17.0, 16.1, 17.1 and 17.5 ms (p95 17.5 ms). The compiled Worker run passed 3/3 with task p95 23.0 ms, Inbox summary p95 24.1 ms and the same four page sizes. These numbers are local diagnostic samples, not service-level objectives.

Before claiming launch performance, measure representative signed-in staff and client journeys on the deployed domain with mobile and desktop profiles. Record p75 LCP ≤2.5 s, INP ≤200 ms and CLS ≤0.1 separately, plus API latency and error rate. Keep the first measurement as a dated baseline and repeat after material UI, schema or dependency changes.

## Run

From `apps/workspace`:

```text
node --test readiness-verification.test.mjs
node --test --test-reporter spec readiness-verification.test.mjs
WORKSPACE_TEST_BUILT_WORKER=1 node --test --test-reporter spec readiness-verification-built.test.mjs
```

The test uses only synthetic actors, projects, messages, tasks and receipts. The `-built` wrapper sets the compiled Worker flag and must be run after `npm run build`. Run both source and compiled variants as part of release checks when the candidate changes authentication, records, notifications, billing or performance-sensitive queries.
