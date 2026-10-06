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
    // Nothing owed (a $0 invoice): 0 closes it as paid, anything else is refused.
    expect(paymentAmountError('0', 0)).toBeNull();
    expect(paymentAmountError('5', 0)).toMatch(/Nothing is owed/);
    expect(paymentAmountError('', 0)).toMatch(/Enter the amount/);
  });

  it('refuses more than two decimal places with a clear message', () => {
    expect(paymentAmountError('12.345', 63)).toMatch(/at most 2 decimal places/);
    expect(paymentAmountError('0.001', 63)).toMatch(/at most 2 decimal places/);
    expect(paymentAmountError('12.34', 63)).toBeNull();
    expect(paymentAmountError('12.3', 63)).toBeNull();
  });

  it('opens the payment dialog on the amount field', () => {
    expect(source).toContain('ref={paymentAmountRef}');
    expect(source).toContain('paymentAmountRef.current?.focus()');
  });

  it('shows the recurrence in plain words, not a raw interval badge', () => {
    expect(source).toContain('recurrenceSummary(invoice)');
    expect(source).not.toContain('{invoice.recurringInterval}');
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
