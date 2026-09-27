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
  unpaid invoices.
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
- Bulk send runs each draft through the single-send path (link, Checkout
  attempt, email, audit) and returns per-item results.

## Overdue reminders

The `overdue-invoices` job marks SENT invoices past their due date OVERDUE
(compare-and-set) and sends the templated overdue email (with currency and
the public link): one reminder, then one escalation from 7 days overdue
(which also flags the client AT_RISK). A reminder is recorded
(`reminderSentAt`) only when the provider accepts it, so failed sends are
retried on the next run. Each invoice and each organization is processed in
isolation; activity logging and notifications are best-effort.

## Payments

Manual payment references (bank, cheque) may repeat across invoices. Stripe
transaction ids remain unique (partial unique index, migration
`20260927022000`) so a replayed webhook cannot record a charge twice.
