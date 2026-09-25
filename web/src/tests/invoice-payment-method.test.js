import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: {}, default: {} }));

const { PAYMENT_METHOD_OPTIONS, paymentMethodLabel } = await import('../pages/InvoiceDetail');

// The backend mark-paid enum (src/validators/schemas.js INVOICE_PAYMENT_METHODS).
const schemas = readFileSync(resolve(process.cwd(), '../src/validators/schemas.js'), 'utf8');
const apiMethods = JSON.parse(
  schemas.match(/INVOICE_PAYMENT_METHODS = (\[[^\]]+\])/)[1].replace(/'/g, '"'),
);

describe('Record payment methods', () => {
  it('only offers values the mark-paid API accepts', () => {
    for (const { value } of PAYMENT_METHOD_OPTIONS) expect(apiMethods).toContain(value);
    expect(PAYMENT_METHOD_OPTIONS.map(({ value }) => value)).toContain('CHEQUE');
    expect(PAYMENT_METHOD_OPTIONS.map(({ value }) => value)).not.toContain('CHECK');
  });

  it('labels canonical and legacy cheque payments the same way', () => {
    expect(paymentMethodLabel('CHEQUE')).toBe('Cheque');
    expect(paymentMethodLabel('CHECK')).toBe('Cheque');
    expect(paymentMethodLabel('BANK')).toBe('Bank Transfer / e-Transfer');
    expect(paymentMethodLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
