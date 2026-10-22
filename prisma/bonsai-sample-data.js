/**
 * Synthetic Bonsai seed data for local demos.
 *
 * These records are fictional. Emails use the reserved example/invalid/test
 * domains. Do not replace them with a real client book. A real export belongs
 * in prisma/bonsai-seed.local.json (gitignored) and is never committed.
 *
 * Local file shape:
 *   { "clients": [], "retainers": [], "invoices": [], "revenue": [] }
 * Dates are ISO strings. Invoice amounts stay in amountUsd or amountCad to
 * match the invoice's currency. See prisma/bonsai-invoice-amount.js.
 */

export const sampleBonsaiSeed = {
  clients: [
    {
      bonsaiId: '1',
      name: 'Northwind Sample Co',
      contactPerson: 'Alex Example',
      email: 'alex@example.invalid',
      country: 'US',
      tier: 'T1',
      serviceType: 'retainer_monthly',
      totalRevenueUsd: 1200,
      status: 'ACTIVE',
    },
    {
      bonsaiId: '2',
      name: 'Harbor Example Studio',
      contactPerson: 'Blair Sample',
      email: 'blair@example.invalid',
      country: 'CA',
      tier: 'T2',
      serviceType: 'project_web',
      totalRevenueCad: 800,
      status: 'ACTIVE',
      notes: 'Synthetic sample client. Not a real account.',
    },
    {
      bonsaiId: '3',
      name: 'Placeholder Goods',
      contactPerson: 'Casey Placeholder',
      email: 'casey@example.test',
      country: 'US',
      tier: 'T3',
      serviceType: 'branding',
      totalRevenueUsd: 100,
      status: 'LEAD',
      notes: 'Synthetic lead. Not a real person.',
    },
  ],
  retainers: [
    {
      bonsaiClientId: '1',
      monthlyUsd: 100,
      billingDay: 1,
      startDate: '2025-01-01',
      renewalDate: '2026-01-01',
    },
  ],
  invoices: [
    {
      number: 'SAMPLE-1001',
      bonsaiClientId: '1',
      amountUsd: 900,
      amountCad: 0,
      currency: 'USD',
      issueDate: '2026-03-01',
      dueDate: '2026-03-15',
      paidDate: '2026-03-05',
      status: 'PAID',
      method: 'credit_card',
      notes: 'Synthetic sample invoice.',
    },
    {
      number: 'SAMPLE-1002',
      bonsaiClientId: '2',
      amountUsd: 0,
      amountCad: 445.01,
      currency: 'CAD',
      issueDate: '2026-02-28',
      dueDate: null,
      status: 'DRAFT',
      notes: 'Synthetic CAD sample. Not a real invoice.',
    },
  ],
  revenue: [
    { month: '2026-01', revenueUsd: 1000, mrr: 100 },
    { month: '2026-02', revenueUsd: 1000, mrr: 100 },
  ],
};
