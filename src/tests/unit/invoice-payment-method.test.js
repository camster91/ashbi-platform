import test from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_PAYMENT_METHODS, markInvoicePaidSchema } from '../../validators/schemas.js';

test('CHEQUE is the canonical cheque payment method', () => {
  assert.ok(INVOICE_PAYMENT_METHODS.includes('CHEQUE'));
  assert.ok(!INVOICE_PAYMENT_METHODS.includes('CHECK'));
  const parsed = markInvoicePaidSchema.parse({ paymentMethod: 'CHEQUE' });
  assert.equal(parsed.paymentMethod, 'CHEQUE');
});

test('the legacy CHECK spelling is accepted and normalized to CHEQUE', () => {
  const parsed = markInvoicePaidSchema.parse({ paymentMethod: 'CHECK', method: 'CHECK' });
  assert.equal(parsed.paymentMethod, 'CHEQUE');
  assert.equal(parsed.method, 'CHEQUE');
});

test('unknown payment methods are still rejected', () => {
  assert.equal(markInvoicePaidSchema.safeParse({ paymentMethod: 'BITCOIN' }).success, false);
  assert.equal(markInvoicePaidSchema.safeParse({ paymentMethod: 'cheque' }).success, false);
});
