import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatByCurrency, monthlyRevenueByCurrency, mrrLabel, retainerMonthlyCharge } from '../lib/retainer-money';

describe('retainer monthly revenue', () => {
  it('counts a CAD-only plan in CAD, not as US$0', () => {
    expect(retainerMonthlyCharge({ monthlyAmountCad: 3000 })).toEqual({ amount: 3000, currency: 'CAD' });
    expect(monthlyRevenueByCurrency([{ monthlyAmountCad: 3000 }, { monthlyAmountCad: 1500, monthlyAmountUsd: 0 }])).toEqual({ CAD: 4500 });
    expect(formatByCurrency({ CAD: 4500 })).toBe('$4,500.00');
  });

  it('counts a plan with a USD rate once, in USD, and keeps currencies apart', () => {
    const totals = monthlyRevenueByCurrency([{ monthlyAmountUsd: 999, monthlyAmountCad: 1350 }, { monthlyAmountCad: 2000 }]);
    expect(totals).toEqual({ USD: 999, CAD: 2000 });
    expect(formatByCurrency(totals)).toBe('$2,000.00 · US$999.00');
    expect(formatByCurrency({})).toBe('$0.00');
  });

  it('labels the dashboard MRR in its own currency', () => {
    expect(mrrLabel({ mrr: 4500, mrrCurrency: 'CAD', mrrByCurrency: { CAD: 4500 } })).toBe('$4.5K');
    const mixed = mrrLabel({ mrr: null, mrrCurrency: null, mrrByCurrency: { CAD: 2000, USD: 999 } });
    expect(mixed).toMatch(/^\$2(\.0)?K · US\$999/);
    expect(mrrLabel({ mrr: 0, mrrCurrency: 'CAD', mrrByCurrency: {} })).toMatch(/^\$0/);
    expect(mrrLabel({ mrr: 0, mrrCurrency: 'CAD', mrrByCurrency: {} })).not.toContain('US$');
  });

  it('never renders a bare amount check that prints a stray 0 next to the client', () => {
    const source = fs.readFileSync(path.resolve('src/pages/Retainers.jsx'), 'utf8');
    expect(source).not.toMatch(/\{plan\.monthlyAmount(Usd|Cad) && \(/);
    expect(source).not.toContain('Monthly Revenue (USD)');
  });
});
