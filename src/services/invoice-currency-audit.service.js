// Invoice currency audit (C3). Until 2026-09 the invoices.currency column
// defaulted to USD and the create/edit routes ignored the requested currency,
// while the staff UI, PDF and emails always said CAD and Stripe charged the
// stored (USD) value. Existing rows are deliberately NOT rewritten by a
// migration (owner decision); scripts/backfill-invoice-currency.mjs uses this
// module to report rows whose stored currency is suspect so the owner can
// decide per invoice.

import { normalizeInvoiceCurrency } from '../utils/money.js';
import { CLEARED_CHECKOUT_FIELDS, expireCheckoutSession } from './stripe.service.js';

const CANADIAN_TAX_TYPES = new Set(['HST', 'GST', 'PST']);

/**
 * @param {Array<{ id: string, invoiceNumber: string, currency: string|null, taxType?: string|null,
 *   bonsaiInvoiceId?: string|null, status: string, stripeCheckoutCurrency?: string|null }>} invoices
 * @returns {Array<{ id: string, invoiceNumber: string, status: string, currency: string|null,
 *   suggestedCurrency: string, reason: string }>}
 */
export function findInvoiceCurrencyMismatches(invoices) {
  const findings = [];
  for (const invoice of invoices) {
    const stored = normalizeInvoiceCurrency(invoice.currency);
    const checkout = normalizeInvoiceCurrency(invoice.stripeCheckoutCurrency);
    if (checkout && stored && checkout !== stored) {
      // A Checkout session was created in a different currency than the
      // invoice now claims; whichever the client paid in is the fact.
      findings.push({ ...pick(invoice), suggestedCurrency: checkout, reason: 'CHECKOUT_CURRENCY_DIFFERS' });
      continue;
    }
    if (stored === 'USD' && !invoice.bonsaiInvoiceId && CANADIAN_TAX_TYPES.has(String(invoice.taxType || '').toUpperCase())) {
      // Created in-app under the old USD column default with Canadian sales
      // tax: most likely meant (and shown to the client) as CAD.
      findings.push({ ...pick(invoice), suggestedCurrency: 'CAD', reason: 'CANADIAN_TAX_ON_USD_INVOICE' });
    }
  }
  return findings;
}

function pick(invoice) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    currency: invoice.currency ?? null,
    checkoutSessionId: invoice.stripeCheckoutSessionId ?? null,
  };
}

/**
 * Apply planned currency rewrites. A stored Checkout session was created in
 * the old currency, so the same compare-and-set update forgets it (the next
 * payment request creates a session in the new currency) and the session is
 * then expired at Stripe so the old-currency link cannot be paid
 * (best-effort; a completion in the wrong currency is still rejected as
 * CHECKOUT_MISMATCH).
 * @returns {Promise<{ applied: any[], changed: any[] }>} changed = rows that
 *   no longer held the audited value and were left alone
 */
export async function applyCurrencyBackfill(prisma, updates, { expire = expireCheckoutSession } = {}) {
  const applied = [];
  const changed = [];
  for (const update of updates) {
    const result = await prisma.invoice.updateMany({
      where: { id: update.id, currency: update.from, status: { not: 'PAID' } },
      data: { currency: update.to, ...CLEARED_CHECKOUT_FIELDS },
    });
    if (result.count !== 1) { changed.push(update); continue; }
    const sessionExpired = update.checkoutSessionId ? await expire(update.checkoutSessionId) : null;
    applied.push({ ...update, sessionExpired });
  }
  return { applied, changed };
}

/**
 * Which findings may be rewritten: only the ids the owner named, and never
 * an invoice that was already paid (its settled currency is historical fact).
 */
export function planCurrencyBackfill(findings, { ids = [], currency }) {
  const target = normalizeInvoiceCurrency(currency);
  if (!target) throw new Error('A supported --currency is required to apply changes');
  const wanted = new Set(ids);
  const updates = [];
  const skipped = [];
  for (const finding of findings) {
    if (!wanted.has(finding.id)) continue;
    if (finding.status === 'PAID') {
      skipped.push({ ...finding, skipReason: 'PAID invoices keep their settled currency' });
      continue;
    }
    updates.push({ id: finding.id, from: finding.currency, to: target, checkoutSessionId: finding.checkoutSessionId ?? null });
  }
  return { updates, skipped };
}
