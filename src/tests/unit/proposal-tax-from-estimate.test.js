// A proposal converted from an estimate shows the tax its invoice will bill
// (an estimate of $1,500 + 5% = $1,575 is a $1,575 proposal to the client,
// and a $1,575 invoice), and a sent estimate can be converted by staff
// without waiting for the client's answer.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import estimateRoutes, { ESTIMATE_CONVERTIBLE_STATUSES, computeEstimateTotals, proposalDataFromEstimate } from '../../routes/estimate.routes.js';
import { proposalInvoiceTaxRate } from '../../routes/invoice.routes.js';
import { DEFAULT_PROPOSAL_TAX_RATE, proposalTaxRate, proposalTaxSummary, taxTypeForRate } from '../../utils/proposal-totals.js';

const LINES = [{ description: 'Website', quantity: 1, rate: 1500 }];

function estimate(overrides = {}) {
  return {
    id: 'est-1', clientId: 'client-1', title: 'Website', description: null, status: 'SENT',
    lineItems: LINES, ...computeEstimateTotals(LINES, { taxRate: 5 }), taxRate: 5, validUntil: null,
    ...overrides,
  };
}

// The proposal as stored and loaded (line items carry `total`).
function storedProposal(data) {
  return { ...data, lineItems: data.lineItems.create };
}

test('a converted estimate proposal shows the estimate tax and total', () => {
  const data = proposalDataFromEstimate(estimate(), { createdById: 'user-1' });
  assert.deepEqual([data.subtotal, data.total], [1500, 1500], 'proposals store the pre-tax amount');
  assert.equal(JSON.parse(data.metadata).taxRate, 5, 'the rate travels in metadata');

  const summary = proposalTaxSummary(storedProposal(data));
  assert.deepEqual(summary, { taxRate: 5, taxType: 'TAX', tax: 75, totalWithTax: 1575 });
});

test('the proposal total matches the estimate total for legacy estimates without a stored rate', () => {
  const legacy = estimate({ taxRate: null, tax: 195, subtotal: 1500, total: 1695 });
  const summary = proposalTaxSummary(storedProposal(proposalDataFromEstimate(legacy, { createdById: 'user-1' })));
  assert.deepEqual([summary.taxRate, summary.tax, summary.totalWithTax], [13, 195, 1695]);
  assert.equal(summary.taxType, 'HST');
});

test('a discount comes off before tax, as on the invoice', () => {
  const proposal = {
    metadata: JSON.stringify({ source: 'estimate', taxRate: 5 }),
    discount: 100,
    total: 1400,
    lineItems: [{ total: 1500 }],
  };
  assert.deepEqual(proposalTaxSummary(proposal), { taxRate: 5, taxType: 'TAX', tax: 70, totalWithTax: 1470 });
});

test('proposals not made from an estimate show the HST their invoice adds', () => {
  const proposal = { metadata: null, discount: 0, total: 1000, lineItems: [{ total: 1000 }] };
  assert.equal(proposalTaxRate(proposal), DEFAULT_PROPOSAL_TAX_RATE);
  assert.equal(proposalInvoiceTaxRate(proposal), DEFAULT_PROPOSAL_TAX_RATE, 'the invoice uses the same rate');
  assert.deepEqual(proposalTaxSummary(proposal), { taxRate: 13, taxType: 'HST', tax: 130, totalWithTax: 1130 });
  assert.equal(proposalTaxRate({ metadata: '{not json' }), 13);
  assert.equal(proposalTaxRate({ metadata: JSON.stringify({ source: 'estimate', taxRate: 0 }) }), 0);
});

test('the invoice tax label is HST only for the 13% default, else neutral', () => {
  assert.equal(taxTypeForRate(13), 'HST');
  assert.equal(taxTypeForRate(5), 'TAX');
  assert.equal(taxTypeForRate(15), 'TAX');
  assert.equal(taxTypeForRate(0), 'NONE');
  assert.equal(taxTypeForRate(null), 'NONE');
});

async function convertApp(t, row, { answerFirst = false } = {}) {
  let current = { ...row, client: { id: 'client-1', name: 'Client' } };
  const created = [];
  const tx = {
    estimate: {
      updateMany: async ({ where, data }) => {
        if (answerFirst) current = { ...current, status: 'APPROVED_ELSEWHERE' };
        const allowed = where.status?.in ?? [where.status];
        if (!allowed.includes(current.status)) return { count: 0 };
        current = { ...current, ...data };
        return { count: 1 };
      },
    },
    proposal: {
      create: async ({ data }) => {
        const proposal = { id: `prop-${created.length + 1}`, ...data, lineItems: data.lineItems.create };
        created.push(proposal);
        return proposal;
      },
    },
  };
  const prisma = {
    estimate: { findUnique: async () => current },
    $transaction: async (fn) => fn(tx),
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'user-1', organizationId: 'org-1', role: 'ADMIN' }; });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(estimateRoutes);
  t.after(() => app.close());
  return { app, created, state: () => current };
}

test('staff can convert a sent estimate as well as an approved one', async (t) => {
  assert.deepEqual([...ESTIMATE_CONVERTIBLE_STATUSES].sort(), ['APPROVED', 'SENT']);
  for (const status of ['SENT', 'APPROVED']) {
    const { app, created, state } = await convertApp(t, estimate({ status }));
    const response = await app.inject({ method: 'POST', url: '/est-1/convert' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(state().status, 'CONVERTED');
    assert.equal(created.length, 1);
    assert.deepEqual(proposalTaxSummary(created[0]).totalWithTax, 1575);
  }
});

test('conversion stays compare-and-set: a draft is refused and a concurrent answer wins', async (t) => {
  const draft = await convertApp(t, estimate({ status: 'DRAFT' }));
  const refused = await draft.app.inject({ method: 'POST', url: '/est-1/convert' });
  assert.equal(refused.statusCode, 400, refused.body);
  assert.equal(draft.created.length, 0);

  const raced = await convertApp(t, estimate({ status: 'SENT' }), { answerFirst: true });
  const conflict = await raced.app.inject({ method: 'POST', url: '/est-1/convert' });
  assert.equal(conflict.statusCode, 409, conflict.body);
  assert.equal(conflict.json().code, 'ESTIMATE_STATUS_CHANGED');
  assert.equal(raced.created.length, 0, 'no proposal without the status claim');
});
