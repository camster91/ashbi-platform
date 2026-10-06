// GET /api/proposals/client/:viewToken is reachable with only the public
// link, so it returns an explicit shape: the client's id, name and email,
// never the Client row (notes, knowledge base, revenue, organization id), and
// none of the proposal's internal, AI, delivery or draft fields.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import proposalRoutes, { PUBLIC_PROPOSAL_CLIENT_SELECT } from '../../routes/proposal.routes.js';

const DAY = 24 * 60 * 60 * 1000;

// A full stored row, as a careless `include: { client: true }` would load it.
const STORED = {
  id: 'prop-1', title: 'Website', status: 'SENT', validUntil: null, subtotal: 1000, discount: 0, total: 1000,
  notes: 'Client-visible notes', internalNotes: 'margin is thin', viewToken: 'tok', sentAt: new Date(), approvedAt: null,
  declinedAt: null, createdAt: new Date(), updatedAt: new Date(), publicAccessExpiresAt: new Date(Date.now() + DAY),
  publicAccessRevokedAt: null, metadata: JSON.stringify({ source: 'estimate', taxRate: 5 }), aiPrompt: 'secret prompt',
  aiModel: 'model-x', draftData: '{}', deliveryMessageId: 'msg', deliveryError: 'bounce', emailContent: '{}',
  gmailThreadId: 'thread', sentToEmail: 'client@example.test', createdById: 'u1', clientId: 'c1', projectId: null,
  client: {
    id: 'c1', name: 'Acme', email: 'billing@acme.test', clientNotes: 'difficult payer', knowledgeBase: '{}',
    communicationPrefs: '{}', satisfactionSignals: '{}', paymentStatus: 'LATE', organizationId: 'org-1', totalRevenue: 99999,
  },
  lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 1000, total: 1000, proposalId: 'prop-1' }],
  createdBy: { name: 'Cameron', email: 'staff@ashbi.test' },
};

test('the public proposal link returns only client-facing fields', async (t) => {
  let query;
  const prisma = {
    proposal: {
      findUnique: async (args) => { query = args; return structuredClone(STORED); },
      update: async () => ({}),
    },
    // The proposal's organization's branding (issue #531): a legacy default
    // row is shown as the organization's own name.
    client: { findUnique: async ({ where }) => (where.id === 'c1' ? { organizationId: 'org-1' } : null) },
    organization: { findUnique: async () => ({ name: 'Northwind Studio', logo: null }) },
    brandSettings: { findUnique: async () => ({ companyName: 'Ashbi Design', logoUrl: '/uploads/brand/logo.png', email: 'hi@northwind.test' }) },
  };
  const app = Fastify();
  app.decorate('authenticate', async () => {});
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(proposalRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/client/tok' });
  assert.equal(response.statusCode, 200, response.body);

  assert.equal(query.include, undefined, 'an explicit select, not include');
  assert.deepEqual(query.select.client, { select: PUBLIC_PROPOSAL_CLIENT_SELECT });
  assert.deepEqual(Object.keys(PUBLIC_PROPOSAL_CLIENT_SELECT).sort(), ['email', 'id', 'name']);

  const body = response.json();
  assert.deepEqual(Object.keys(body.client).sort(), ['email', 'id', 'name']);
  assert.deepEqual(Object.keys(body).sort(), [
    'approvedAt', 'brand', 'client', 'createdAt', 'createdBy', 'declinedAt', 'discount', 'id', 'lineItems', 'notes', 'sentAt',
    'status', 'subtotal', 'tax', 'taxRate', 'taxType', 'title', 'total', 'totalWithTax', 'validUntil',
  ]);
  assert.deepEqual(Object.keys(body.lineItems[0]).sort(), ['description', 'id', 'quantity', 'total', 'unitPrice']);
  assert.deepEqual(body.createdBy, { name: 'Cameron' });
  // Only the name and a publicly loadable logo: a staff-only stored upload
  // and the brand's contact details stay private.
  assert.deepEqual(body.brand, { companyName: 'Northwind Studio', logoUrl: null });
  assert.doesNotMatch(response.body, /Ashbi Design|hi@northwind|uploads\/brand/);
  assert.equal(body.status, 'VIEWED');
  assert.deepEqual([body.tax, body.totalWithTax], [50, 1050]);
  assert.doesNotMatch(
    response.body,
    /difficult payer|LATE|org-1|99999|margin is thin|secret prompt|model-x|bounce|thread|staff@ashbi|"tok"|metadata|knowledgeBase/,
  );
});
