import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPaymentPayload, paymentAmountError } from '../pages/InvoiceDetail';

const source = fs.readFileSync(path.resolve('src/pages/InvoiceDetail.jsx'), 'utf8');

describe('recording a (partial) invoice payment', () => {
  it('always sends the amount explicitly, rounded to cents', () => {
    const form = { paymentMethod: 'BANK', paymentNotes: '', transactionId: '' };
    expect(buildPaymentPayload({ ...form, amount: '50.25' })).toEqual({ ...form, amount: 50.25 });
    expect(buildPaymentPayload({ ...form, amount: '63.004' })).toEqual({ ...form, amount: 63 });
  });

  it('blocks an empty, invalid, zero, negative or excessive amount', () => {
    expect(paymentAmountError('', 63)).toMatch(/Enter the amount/);
    expect(paymentAmountError('abc', 63)).toMatch(/Enter the amount/);
    expect(paymentAmountError('0', 63)).toMatch(/greater than zero/);
    expect(paymentAmountError('-5', 63)).toMatch(/greater than zero/);
    expect(paymentAmountError('63.01', 63)).toMatch(/more than the balance/);
    expect(paymentAmountError('63', 63)).toBeNull();
    expect(paymentAmountError('0.01', 63)).toBeNull();
  });

  it('labels the amount field, disables submit on an invalid amount and shows what is still owed', () => {
    expect(source).toContain('htmlFor="invoice-payment-amount"');
    expect(source).toContain('id="invoice-payment-amount"');
    expect(source).toContain('disabled={markPaidMutation.isPending || Boolean(amountError)}');
    expect(source).toContain('invoice.balanceDue');
    expect(source).toContain('Balance due');
  });

  it('hides Void for an invoice with recorded payments', () => {
    expect(source).toContain('!hasPayments');
  });
});
