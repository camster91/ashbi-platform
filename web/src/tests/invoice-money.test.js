import { describe, expect, it } from 'vitest';
import { formatInvoiceDate, formatInvoiceMoney, toDateInputValue } from '../lib/format';
import { statMoney } from '../pages/Invoices';

describe('invoice money and dates', () => {
  it('formats amounts in the invoice currency with its code', () => {
    expect(formatInvoiceMoney(1250, 'CAD')).toBe('$1,250.00 CAD');
    expect(formatInvoiceMoney(1250, 'usd')).toBe('$1,250.00 USD');
    expect(formatInvoiceMoney(10, 'EUR')).toBe('€10.00 EUR');
    expect(formatInvoiceMoney(5)).toBe('$5.00 CAD');
  });

  it('renders a date-only due date as the chosen day in any timezone', () => {
    // Stored by the API as the end of 2026-10-11 in UTC.
    expect(toDateInputValue('2026-10-11T23:59:59.999Z')).toBe('2026-10-11');
    expect(formatInvoiceDate('2026-10-11T23:59:59.999Z', { month: 'long' })).toMatch(/11/);
    expect(formatInvoiceDate(null)).toBe('—');
  });

  it('shows stats per currency when invoices use more than one', () => {
    const single = { currencies: ['USD'], mixedCurrency: false, totalOutstanding: 40, paid: { amount: 10 } };
    expect(statMoney(single, 'totalOutstanding')).toBe('$40.00 USD');
    const mixed = {
      currencies: ['CAD', 'USD'],
      mixedCurrency: true,
      totalOutstanding: null,
      byCurrency: { CAD: { totalOutstanding: 100 }, USD: { totalOutstanding: 40 } },
    };
    expect(statMoney(mixed, 'totalOutstanding')).toBe('$100.00 CAD · $40.00 USD');
    expect(statMoney({}, 'paid')).toBe('$0.00 CAD');
  });
});
