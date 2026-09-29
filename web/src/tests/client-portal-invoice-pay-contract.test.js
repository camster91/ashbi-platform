import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

// H10/H12: the portal never offers to pay a draft or void invoice, and Pay
// always opens the public invoice page (which starts a fresh Stripe Checkout
// session) instead of a stored Checkout URL that expires within 24 hours.
describe('client portal invoice pay contract', () => {
  it('only offers Pay for sent or overdue invoices with a server-issued pay link', () => {
    expect(source).toContain("['SENT', 'OVERDUE'].includes(inv.status?.toUpperCase()) && Boolean(inv.payUrl)");
    expect(source).not.toMatch(/canPay[^\n]*DRAFT/);
    expect(source).toContain('href={inv.payUrl}');
  });

  it('never links to a stored Stripe Checkout URL', () => {
    expect(source).not.toContain('stripePaymentLink');
  });
});
