import test from 'node:test';
import assert from 'node:assert/strict';
import { getProjectBudgetMetrics } from '../../services/project.service.js';
const entry = (fields = {}) => ({ userId: 'u1', duration: 60, billable: true, date: new Date(), user: { id: 'u1', name: 'Member', hourlyRate: 100 }, ...fields });
async function metrics({ project = {}, entries = [], expenses = [] } = {}) {
  const calls = [];
  const result = await getProjectBudgetMetrics({ project: { findUnique: async args => { calls.push(args); return { id: 'project-a', name: 'Synthetic project', budget: 1000, hourlyBudget: 10, ...project }; } },
    timeEntry: { findMany: async args => { assert.deepEqual(args.where, { projectId: 'project-a' }); return entries; } },
    expense: { findMany: async args => { assert.deepEqual(args.where, { projectId: 'project-a' }); return expenses; } } }, 'project-a');
  assert.deepEqual(calls[0].where, { id: 'project-a' }); return result;
}
test('known entry overrides include zero, null falls back to user rate, and invalid explicit rates never silently fall back', async () => {
  const result = await metrics({ entries: [entry({ hourlyRate: 0 }), entry({ hourlyRate: 20 }), entry({ hourlyRate: null }), entry()] });
  assert.equal(result.totalCost, 220); assert.equal(result.labor.knownRateAmount, 220); assert.equal(result.costByUser[0].cost, 220);
  assert.equal(result.labor.complete, true); assert.equal(result.labor.currency, null); assert.equal(result.labor.currencyVerified, false);
  for (const hourlyRate of [-1, Number.NaN, Number.POSITIVE_INFINITY, '50']) {
    const invalid = await metrics({ entries: [entry({ hourlyRate })] });
    assert.equal(invalid.totalCost, null); assert.equal(invalid.labor.missingRateEntries, 1); assert.equal(invalid.labor.knownRateAmount, 0);
  }
});
test('missing rates expose partial amounts and unpriced minutes without reporting zero total cost', async () => {
  const result = await metrics({ entries: [entry({ duration: 120 }), entry({ userId: 'u2', user: { id: 'u2', name: 'Unpriced', hourlyRate: null }, duration: 30 })] });
  assert.equal(result.time.totalHours, 2.5); assert.equal(result.totalCost, null); assert.equal(result.labor.knownRateAmount, 200);
  assert.equal(result.labor.missingRateMinutes, 30); assert.equal(result.labor.missingRateEntries, 1); assert.equal(result.labor.complete, false);
  assert.equal(result.costByUser[0].cost, 200); assert.equal(result.costByUser[1].cost, null);
  assert.ok(result.financial.reasons.includes('MISSING_TIME_RATES'));
});
test('no fixed price never invents a rate of fifty and hourly progress remains independent', async () => {
  const result = await metrics({ project: { budget: null, hourlyBudget: 4 }, entries: [entry({ duration: 120, user: null })] });
  assert.equal(result.totalCost, null); assert.equal(result.budgetUsed, null); assert.equal(result.budgetRemaining, null);
  assert.equal(result.hoursPercentUsed, 50); assert.equal(result.percentUsed, 50); assert.equal(result.hoursRemaining, 2);
});
test('mixed expense currencies remain separate and cannot create a combined budget comparison', async () => {
  const result = await metrics({ entries: [entry()], expenses: [{ amount: 20, currency: 'CAD' }, { amount: 30, currency: 'USD' }, { amount: 5, currency: 'CAD' }] });
  assert.equal(result.expenses.total, null); assert.deepEqual(result.expenses.currencies, ['CAD', 'USD']); assert.equal(result.expenses.mixedCurrency, true);
  assert.deepEqual(result.expenses.byCurrency, { CAD: { total: 25, count: 2 }, USD: { total: 30, count: 1 } });
  assert.equal(result.totalCost, 100); assert.equal(result.budgetUsed, null); assert.equal(result.budgetRemaining, null); assert.equal(result.percentUsed, null);
  assert.equal(result.financial.available, false); assert.ok(result.financial.reasons.includes('RATE_CURRENCY_UNSPECIFIED')); assert.ok(result.financial.reasons.includes('MIXED_EXPENSE_CURRENCIES'));
});
test('unknown expense currency is explicit, no invoice default is inferred, and single-currency totals stay numeric', async () => {
  const result = await metrics({ expenses: [{ amount: 99 }, { amount: 15, currency: 'XYZ' }, { amount: 20, currency: 'CAD' }] });
  assert.equal(result.expenses.total, null); assert.equal(result.expenses.unknownCurrencyCount, 2);
  assert.deepEqual(result.expenses.byCurrency, { CAD: { total: 20, count: 1 } });
  const single = await metrics({ expenses: [{ amount: 0, currency: 'USD' }, { amount: 12, currency: 'USD' }] });
  assert.equal(single.expenses.total, 12); assert.equal(single.expenses.mixedCurrency, false); assert.deepEqual(single.expenses.currencies, ['USD']);
});
test('empty data has a genuine zero recorded rate amount and no expenses, while unset denominators stay unknown', async () => {
  for (const value of [0, null]) {
    const result = await metrics({ project: { budget: value, hourlyBudget: value } });
    assert.equal(result.totalCost, 0); assert.equal(result.labor.complete, true); assert.equal(result.expenses.total, 0);
    assert.equal(result.hoursRemaining, null); assert.equal(result.hoursPercentUsed, null); assert.equal(result.percentUsed, null); assert.equal(result.budgetUsed, null);
    assert.equal(result.project.budget, value); assert.equal(result.project.hourlyBudget, value);
  }
});
test('a missing project returns null without reading time or expenses', async () => {
  assert.equal(await getProjectBudgetMetrics({ project: { findUnique: async () => null } }, 'missing'), null);
});
