// GET /api/proposals/:id: the linked contract is a status summary only (never
// the signing token, signer IP / user agent or signature hashes), and client
// revenue and the project budget stay admin-only.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import proposalRoutes, { PROPOSAL_CONTRACT_SUMMARY } from '../../routes/proposal.routes.js';

const stored = {
  id: 'proposal-a', title: 'Brand refresh', status: 'APPROVED', total: 1000, subtotal: 1000, discount: 0,
  clientId: 'client-a', projectId: 'project-a', lineItems: [], createdBy: { id: 'u', name: 'Cam' },
  client: { id: 'client-a', name: 'Northwind', totalRevenueCad: 9000, totalRevenueUsd: 100, paymentStatus: 'CURRENT', lastInvoiceStatus: 'PAID', lastInvoiceDate: null },
  project: { id: 'project-a', name: 'Rebuild', budget: 12000, hourlyBudget: 40 },
};
const fullContract = {
  id: 'contract-a', title: 'Agreement', status: 'SIGNED', clientSigName: 'Ana', clientSigDate: '2026-10-01', signedAt: '2026-10-01',
  signToken: 'bearer-sign-token', signerIp: '203.0.113.9', signerUserAgent: 'Mozilla/5.0', clientSigHash: 'h1', signatureDataHash: 'h2', signedContentHash: 'h3', content: 'Full body',
};

async function getAs(t, role) {
  let args;
  const prisma = {
    proposal: {
      findUnique: async (a) => {
        args = a;
        const select = a.include.contract.select;
        const contract = select ? Object.fromEntries(Object.keys(select).filter((k) => k in fullContract).map((k) => [k, fullContract[k]])) : fullContract;
        return structuredClone({ ...stored, contract });
      },
    },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u', role, organizationId: 'org-a' }; });
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(proposalRoutes);
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/proposal-a' });
  return { body: response.json(), status: response.statusCode, args };
}

test('the contract on a proposal is a summary: no signing token, signer IP, user agent or hashes', async (t) => {
  for (const role of ['ADMIN', 'TEAM']) {
    const { body, status, args } = await getAs(t, role);
    assert.equal(status, 200);
    assert.deepEqual(args.include.contract, { select: PROPOSAL_CONTRACT_SUMMARY });
    for (const field of ['signToken', 'signerIp', 'signerUserAgent', 'clientSigHash', 'signatureDataHash', 'signedContentHash', 'content']) {
      assert.equal(field in body.contract, false, `${role} must not receive contract.${field}`);
    }
    assert.equal(body.contract.status, 'SIGNED');
    assert.equal(body.contract.clientSigName, 'Ana');
  }
});

test('team members get no client revenue or project budget on a proposal; admins do', async (t) => {
  const team = (await getAs(t, 'TEAM')).body;
  for (const field of ['totalRevenueCad', 'totalRevenueUsd', 'paymentStatus', 'lastInvoiceStatus']) {
    assert.equal(field in team.client, false, `TEAM must not receive client.${field}`);
  }
  assert.equal('budget' in team.project, false);
  assert.equal(team.project.hourlyBudget, 40, 'hour budgets are not money');
  assert.equal(team.client.name, 'Northwind');
  assert.equal(team.total, 1000, 'proposal amounts stay visible to staff who build proposals');

  const admin = (await getAs(t, 'ADMIN')).body;
  assert.equal(admin.client.totalRevenueCad, 9000);
  assert.equal(admin.project.budget, 12000);
});
