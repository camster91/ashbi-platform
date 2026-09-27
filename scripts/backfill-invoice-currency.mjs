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
//
// Requires DATABASE_URL. Scans every organization (maintenance script, not a
// request), so run it only with operator credentials.

import { rawPrisma } from '../src/config/db.js';
import { findInvoiceCurrencyMismatches, planCurrencyBackfill } from '../src/services/invoice-currency-audit.service.js';

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
    taxType: true, bonsaiInvoiceId: true, stripeCheckoutCurrency: true,
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
  for (const update of plan.updates) {
    // Compare-and-set: only rewrite a row that still holds the audited value.
    await rawPrisma.invoice.updateMany({
      where: { id: update.id, currency: update.from, status: { not: 'PAID' } },
      data: { currency: update.to },
    });
  }
  report.applied = plan.updates;
  report.skipped = plan.skipped;
  report.notSuspect = ids.filter((id) => !findings.some((finding) => finding.id === id));
}

console.log(JSON.stringify(report, null, 2));
await rawPrisma.$disconnect();
