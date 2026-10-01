# Invoicing: numbering, currency, links and reminders

How invoices behave from creation to payment. Code-present; provider
(Stripe, Mailgun) and target-environment evidence remain under
[#280](https://github.com/camster91/ashbi-platform/issues/280),
[#378](https://github.com/camster91/ashbi-platform/issues/378) and
[#379](https://github.com/camster91/ashbi-platform/issues/379).

## Creating and editing

- `POST /api/invoices` and `PUT /api/invoices/:id` (drafts only) accept the
  staff UI's payloads (`web/src/lib/invoice-payloads.js`, validated by
  `src/tests/unit/invoice-web-payload-contract.test.js`).
- **Dates.** A date-only due date (`YYYY-MM-DD`, from `<input type="date">`)
  is stored as the **end of that day in UTC** (`23:59:59.999Z`), so an
  invoice becomes overdue only once the day is over; a date-only issue date
  is the start of that day in UTC. Full ISO 8601 datetimes are accepted too.
  Omitted or `null` due date means "due upon receipt". Invoice dates are
  displayed in UTC (UI, PDF, emails) so the chosen day round-trips.
- **Title** is optional; the API derives `Invoice for <client name>`.
- **Line item types:** LABOR, MATERIAL(S), EXPENSE, DISCOUNT, CUSTOM, OTHER.

## Numbering

- Format `INV-<year>-<n>` (year in UTC, `n` zero-padded to 4 digits and
  continuing past 9999).
- Numbers are unique **per organization** (`@@unique([organizationId,
  invoiceNumber])`); two organizations can both have `INV-2026-0001`.
- `n` comes from the organization's row in `document_number_sequences`,
  incremented atomically (`INSERT … ON CONFLICT DO UPDATE … RETURNING`)
  inside the transaction that creates the invoice (`src/utils/invoice.js`).
  Concurrent creates get distinct consecutive numbers; a rolled-back create
  frees its number; a number already present (for example an import) is
  skipped.
- `invoices.organizationId` always equals the client's organization: the
  application sets it and a database trigger derives it from the client.
- Migration `20260927021000` seeded each organization's counter from its
  highest existing `INV-<year>-<n>` number (compared numerically).
- A unique-constraint violation returns a generic `409 Conflict`; Prisma
  error text is never returned to clients.
- Estimates, proposals and contracts have no document numbers.

## Currency

- Each invoice stores an ISO 4217 code (CAD, USD, EUR, GBP —
  `src/utils/money.js`). It is what the UI, PDF, emails and public page show
  (`$1,250.00 USD` via `Intl.NumberFormat`) and what Stripe charges.
- New invoices default to **CAD** when the request names none: organizations
  have no currency setting yet (`defaultInvoiceCurrency()` is the one place
  to change when they do). Proposal-generated invoices use the default.
- Before migration `20260927020000` the column defaulted to USD while the UI
  said CAD. **Existing rows were not rewritten (owner decision).** Run
  `node scripts/backfill-invoice-currency.mjs` for a read-only report of
  suspect rows; `--apply --currency CAD --ids a,b` rewrites only the listed,
  unpaid invoices (compare-and-set on the audited value). Each rewrite also
  clears the invoice's stored Checkout session, which was created in the old
  currency, and expires it at Stripe (best-effort), so the client's next
  payment opens a fresh session in the new currency.
- Invoice stats group money by currency (`byCurrency`, `currencies`,
  `mixedCurrency`). The top-level amounts are filled only when all invoices
  share one currency; with several currencies they are `null` (counts stay
  totals). `sent` and `overdue` are disjoint and `totalOutstanding` is their
  sum, so no invoice is counted twice.

## Public links and payment

- Sending issues a high-entropy token for `/portal/invoice/:token`. The link
  stays valid while the invoice is **SENT or OVERDUE** (not tied to the due
  date), and for **30 days after it is PAID or VOID** (receipt grace) or
  until its recorded expiry if later. Revoked or never-issued links fail
  with 410.
- Every Pay action — invoice and overdue emails, the client portal, staff
  "copy link" — opens the public invoice page, which creates or refreshes a
  Stripe Checkout session on demand. Stored Checkout URLs (24-hour expiry)
  are never emailed or exposed to the portal.
- OVERDUE is accepted wherever SENT is: resend, payment link, rotate, pay.
  VOID invoices are viewable but never payable.
- The client portal lists only SENT, OVERDUE and PAID invoices.
- Sending claims DRAFT→SENT with the new token (compare-and-set) before any
  Checkout session or email, so concurrent sends email once and the emailed
  link is the stored one; a losing send gets 409 `ALREADY_SENT`.
- Bulk send runs each draft through the single-send path (link, Checkout
  attempt, email, audit) and returns per-item results (`reason:
  'already_sent'` for a draft another send claimed). At most 25 ids per
  request, because each item is sent sequentially.
- Voiding (single or bulk archive) clears the stored Checkout session and
  expires it at Stripe (best-effort). A Checkout completion only settles a
  SENT or OVERDUE invoice; a payment for a VOID invoice is acknowledged as
  `INVOICE_VOID`, alerted for a refund/re-issue decision, and never turns the
  invoice PAID (see [event-outbox.md](event-outbox.md)).
- The public invoice page shows the stored subtotal, discount, tax and total
  and hides Pay when the total is zero.

## Overdue reminders

The `overdue-invoices` job marks SENT invoices past their due date OVERDUE
(compare-and-set) and sends the templated overdue email (with currency and
the public link): one reminder, then one escalation from 7 days overdue
(which also flags the client AT_RISK and sets `overdueEscalatedAt`).

- Each message is **claimed before it is sent**: a compare-and-set on
  `reminderSentAt` / `overdueEscalatedAt` while the invoice is still SENT or
  OVERDUE. A payment or void landing mid-run, or an overlapping run, makes
  the claim fail and nothing is sent. A failed delivery releases the claim,
  so the next run retries it.
- Escalated invoices leave the working set; the rest are paged by id, so
  new overdue invoices are always reached.
- Each invoice and each organization is processed in isolation; activity
  logging and notifications are best-effort.
- **Upgrade from the previous job.** Migrations `20260927023000` and
  `20260927023100` mark invoices the previous job already escalated (its
  escalation never set `reminderSentAt`): rows whose reminder went out 7+
  days after the due date, rows with its `escalated` activity, and open
  OVERDUE rows with no reminder recorded. They get no second urgent email.
  Invoices the previous job only reminded may still get the one escalation.

## Retainer invoices

Retainer plans hold a monthly CAD and/or USD amount. A retainer invoice
defaults to CAD and bills only the amount in its currency; it is refused
(`RETAINER_RATE_MISSING`) when that amount is not set.

Each retainer invoice records its billing month (`retainerPeriod`, the UTC
month, `YYYY-MM`). A partial unique index allows one live (not VOID, not
deleted) retainer invoice per client and month (migration
`20261001180000_invoice_retainer_period`), so a double click or retry answers
409 `RETAINER_PERIOD_ALREADY_INVOICED` with the existing invoice. The optional
hours reset commits in the same transaction as the invoice. A voided month can
be billed again; undoing that void is then refused (409). The period defaults
to the current UTC month (the server has no per-organization time zone); staff
can pass `period` (`YYYY-MM`) to bill a month explicitly.

## Recurring invoices

`recurringNextDate` is set when an invoice is created or edited with
`isRecurring` (the first date one interval after the issue date that is in the
future, always on the issue date's day of month, clamped in short months) and
cleared when recurrence is turned off. The hourly job copies only invoices that
were issued to the client (SENT, OVERDUE or PAID): a DRAFT may never be sent
and a VOID one was cancelled. Each occurrence is claimed with a
compare-and-set on `recurringNextDate` in a serializable transaction, so a
retry or a second worker never creates a second copy, and a source that missed
several periods is billed once and moved to its next future date. Migration
`20261001180000_invoice_retainer_period` backfilled the date for issued
recurring invoices created before it was set; a recurring draft without a
date gets one when it is sent.

## Payments

An invoice's balance is its total minus the sum of its payment rows.
`POST /api/invoices/:id/mark-paid` takes an optional `amount` (default: the
remaining balance; the payment dialog always sends it). Only SENT or OVERDUE
invoices take payments (a DRAFT answers 400 `INVOICE_NOT_SENT`). A payment
that leaves a balance keeps the invoice open and writes only
`payment.recorded`; the one that covers the total moves it to PAID and writes
`invoice.paid`. More than the balance is refused (400
`PAYMENT_EXCEEDS_BALANCE`), as is zero or less (400 `PAYMENT_AMOUNT_INVALID`).
The invoice API, the public portal, the invoice stats, the dashboard and the
invoice chaser report the balance (`amountPaid`, `balanceDue`).

Every payment, manual or Stripe, claims the invoice row first and then reads
the balance (src/services/invoice-settlement.js), so concurrent payments run
one after the other, and bumps `stripeCheckoutAttempt`. Checkout sessions are
priced from the balance and stored with a compare-and-set on that counter: a
session priced before a payment landed is expired at Stripe and a new one is
created. A Checkout completion that pays at most the balance is recorded (a
stale, smaller session is a partial payment); one that pays more is not
recorded and is alerted as `CHECKOUT_BALANCE_CHANGED` (staff refund the
excess), next to the existing `INVOICE_ALREADY_PAID` and `INVOICE_VOID`
alerts. An invoice with recorded payments cannot be voided (409
`INVOICE_HAS_PAYMENTS`; bulk archive reports `has_payments`).

### Refused Stripe charges

A Checkout charge the webhook refuses (`CHECKOUT_BALANCE_CHANGED`,
`INVOICE_ALREADY_PAID`, `INVOICE_VOID`) is acknowledged to Stripe, alerted
(`stripe_checkout_balance_changed`, `stripe_checkout_invoice_already_paid`,
`stripe_checkout_invoice_void`) and recorded as a `payment.refused` audit
event on the invoice with the code, amount, currency, Stripe event id and
payment intent. Operators find them in the audit log
(`GET /api/audit-events?action=payment.refused`, admin) or by invoice
(`entityType=invoice&entityId=<invoice id>`), then refund the payment intent
in Stripe or record it against the right invoice. A replayed delivery of a
charge that was recorded is a duplicate, not a refusal.

Manual payment references (bank, cheque) may repeat across invoices. Stripe
transaction ids remain unique (partial unique index, migration
`20260927022000`) so a replayed webhook cannot record a charge twice.
