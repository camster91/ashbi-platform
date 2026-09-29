#!/usr/bin/env node
// Invoice currency audit / owner-approved backfill.
//
// Background: invoices.currency defaulted to USD and the API ignored the
// requested currency, while the UI, PDFs and emails said CAD (and Stripe
// charged the stored value). Migration 20260927020000 changes the column
// default to CAD for NEW rows only; existing rows are intentionally left as
// they are until the owner decides.
//
// Dry run (default) — read-only report of suspect rows, as JSON:
//   node scripts/backfill-invoice-currency.mjs
//
// Apply — only for invoices the owner lists, never for PAID invoices:
//   node scripts/backfill-invoice-currency.mjs --apply --currency CAD --ids inv_1,inv_2
// Each rewrite also clears the invoice's stored Checkout session (created in
// the old currency) and expires it at Stripe when STRIPE_SECRET_KEY is set,
// so the client's next payment uses a fresh session in the new currency.
//
// Requires DATABASE_URL. Scans every organization (maintenance script, not a
// request), so run it only with operator credentials.

import { rawPrisma } from '../src/config/db.js';
import { applyCurrencyBackfill, findInvoiceCurrencyMismatches, planCurrencyBackfill } from '../src/services/invoice-currency-audit.service.js';

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const apply = process.argv.includes('--apply');
const ids = (argValue('--ids') || '').split(',').map((id) => id.trim()).filter(Boolean);
const currency = argValue('--currency');

const invoices = await rawPrisma.invoice.findMany({
  where: { deletedAt: null },
  select: {
    id: true, invoiceNumber: true, clientId: true, status: true, currency: true,
    taxType: true, bonsaiInvoiceId: true, stripeCheckoutCurrency: true, stripeCheckoutSessionId: true,
  },
  orderBy: { createdAt: 'asc' },
});
const findings = findInvoiceCurrencyMismatches(invoices);
const report = { mode: apply ? 'apply' : 'dry-run', scanned: invoices.length, suspect: findings.length, findings };

if (apply) {
  if (ids.length === 0) {
    console.error('Refusing to apply without --ids (the owner must name each invoice).');
    await rawPrisma.$disconnect();
    process.exit(64);
  }
  const plan = planCurrencyBackfill(findings, { ids, currency });
  // Compare-and-set per row; the stored Checkout session (old currency) is
  // cleared in the same update and expired at Stripe (best-effort).
  const { applied, changed } = await applyCurrencyBackfill(rawPrisma, plan.updates);
  report.applied = applied;
  report.changedSinceAudit = changed;
  report.skipped = plan.skipped;
  report.notSuspect = ids.filter((id) => !findings.some((finding) => finding.id === id));
}

console.log(JSON.stringify(report, null, 2));
await rawPrisma.$disconnect();
