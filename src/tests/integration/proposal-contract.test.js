// Proposal + Contract tests — Node.js built-in test runner
// Run: node --test src/tests/proposal-contract.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import requestPrisma, { prisma, rawPrisma } from '../../config/db.js';
import proposalRoutes from '../../routes/proposal.routes.js';
import contractRoutes from '../../routes/contract.routes.js';
import { shouldSkipHeavyTests } from '../_test-skip.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';

const skip = shouldSkipHeavyTests();

let fastify;
let authToken;
let testClientId;
let testProjectId;
let testUserId;
let createdProposalId;
let createdContractId;
let testOrganizationId;

before(async () => {
  if (skip) return;
  fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, { secret: 'test-secret', cookie: { cookieName: 'token', signed: false } });

  fastify.decorate('prisma', requestPrisma);
  fastify.decorate('io', { to: () => ({ emit: () => {} }) });

  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); }
    catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });
  fastify.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  fastify.addHook('preHandler', async (request) => {
    if (request.user?.organizationId) {
      const scopedPrisma = createScopedPrisma(prisma, request.user.organizationId);
      request.prisma = scopedPrisma;
      enterRequestContext({ prisma: scopedPrisma, organizationId: request.user.organizationId });
    } else {
      request.prisma = rawPrisma;
      enterRequestContext({ prisma: rawPrisma, organizationId: null });
    }
  });

  await fastify.register(proposalRoutes, { prefix: '/api/proposals' });
  await fastify.register(contractRoutes, { prefix: '/api/contracts' });
  await fastify.ready();

  const organization = await rawPrisma.organization.upsert({
    where: { slug: 'proposal-contract-integration-test' },
    update: {},
    create: { name: 'Proposal Contract Integration Test', slug: 'proposal-contract-integration-test' },
  });
  testOrganizationId = organization.id;

  const user = await rawPrisma.user.upsert({
    where: { email: 'test-proposal@ashbi.ca' },
    update: {},
    create: { email: 'test-proposal@ashbi.ca', name: 'Test Prop User', password: 'hashed', role: 'ADMIN', organizationId: organization.id }
  });
  testUserId = user.id;

  const client = await rawPrisma.client.create({
    data: {
      organizationId: organization.id,
      name: 'Test Client — Proposal Suite',
      contacts: { create: [{ name: 'Jane Prop', email: 'jane@proptest.com', isPrimary: true }] }
    }
  });
  testClientId = client.id;

  const project = await rawPrisma.project.create({
    data: { name: 'Test Project — Proposals', clientId: testClientId, organizationId: organization.id }
  });
  testProjectId = project.id;

  authToken = fastify.jwt.sign({ id: user.id, email: user.email, role: 'ADMIN', organizationId: organization.id });
});

after(async () => {
  if (skip) return;
  try {
    await rawPrisma.contract.deleteMany({ where: { clientId: testClientId } });
    await rawPrisma.proposalLineItem.deleteMany({ where: { proposal: { clientId: testClientId } } });
    await rawPrisma.proposal.deleteMany({ where: { clientId: testClientId } });
    await rawPrisma.task.deleteMany({ where: { projectId: testProjectId } });
    await rawPrisma.project.delete({ where: { id: testProjectId } }).catch(() => null);
    await rawPrisma.contact.deleteMany({ where: { clientId: testClientId } });
    await rawPrisma.client.delete({ where: { id: testClientId } }).catch(() => null);
    await rawPrisma.user.delete({ where: { id: testUserId } }).catch(() => null);
    await rawPrisma.organization.delete({ where: { id: testOrganizationId } }).catch(() => null);
    await prisma.$disconnect();
  } catch (err) {
    // DB cleanup errors are non-fatal in test teardown
  }
  await fastify.close();
});

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

// ── Proposals ──────────────────────────────────────────────────────────────

describe('Proposal CRUD', { skip }, () => {

  test('POST /api/proposals — create proposal with line items', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: authHeaders(),
      payload: {
        title: 'Brand Redesign Proposal',
        clientId: testClientId,
        projectId: testProjectId,
        validUntil: '2027-06-30T23:59:59.000Z',
        notes: 'Includes 2 revision rounds',
        lineItems: [
          { description: 'Brand Strategy', quantity: 1, unitPrice: 5000, total: 5000 },
          { description: 'Visual Identity', quantity: 1, unitPrice: 3000, total: 3000 },
        ],
      },
    });

    assert.equal(res.statusCode, 201, `Expected 201, got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.id);
    assert.equal(body.status, 'DRAFT');
    assert.equal(body.title, 'Brand Redesign Proposal');
    assert.ok(body.viewToken, 'Should have a viewToken for client sharing');
    assert.equal(body.lineItems.length, 2);
    assert.equal(body.subtotal, 8000);

    createdProposalId = body.id;
    console.log(`  ✓ Created proposal: ${body.title}`);
  });

  test('GET /api/proposals — list proposals', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/proposals',
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    console.log(`  ✓ Listed ${body.length} proposals`);
  });

  test('GET /api/proposals/:id — get proposal detail', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/proposals/${createdProposalId}`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, createdProposalId);
    assert.ok(body.lineItems.length > 0);
    console.log(`  ✓ Got proposal detail`);
  });

  test('POST /api/proposals/:id/send — send proposal', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/proposals/${createdProposalId}/send`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'SENT');
    assert.ok(body.sentAt);
    assert.equal(body.emailSent, false);
    console.log(`  ✓ Sent proposal`);
  });

  test('POST /api/proposals/client/:viewToken/approve — approve proposal', async () => {
    const proposal = await rawPrisma.proposal.findUnique({ where: { id: createdProposalId } });
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/proposals/client/${proposal.viewToken}/approve`,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'APPROVED');
    assert.ok(body.approvedAt);
    console.log(`  ✓ Approved proposal`);
  });

});

// ── Contracts ──────────────────────────────────────────────────────────────

describe('Contract CRUD', { skip }, () => {

  test('POST /api/contracts — create contract from proposal', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/contracts',
      headers: authHeaders(),
      payload: {
        title: 'Brand Redesign Contract',
        content: '<h1>Scope of Work</h1><p>Full brand redesign including strategy and visual identity.</p>',
        templateType: 'PROJECT',
        clientId: testClientId,
        proposalId: createdProposalId,
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.ok(body.id);
    assert.equal(body.status, 'DRAFT');
    assert.equal(body.title, 'Brand Redesign Contract');
    assert.ok(body.signToken, 'Should have a signToken for client signing');
    assert.equal(body.proposalId, createdProposalId);

    createdContractId = body.id;
    console.log(`  ✓ Created contract from proposal`);
  });

  test('GET /api/contracts — list contracts', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/contracts',
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    console.log(`  ✓ Listed ${body.length} contracts`);
  });

  test('GET /api/contracts/:id — get contract detail', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/contracts/${createdContractId}`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, createdContractId);
    assert.equal(body.status, 'DRAFT');
    console.log(`  ✓ Got contract detail`);
  });

  test('POST /api/contracts/:id/send — send contract for signing', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/contracts/${createdContractId}/send`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'SENT');
    console.log(`  ✓ Sent contract for signing`);
  });

  test('POST /api/contracts/sign/:signToken — sign contract', async () => {
    const contract = await rawPrisma.contract.findUnique({ where: { id: createdContractId } });

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/contracts/sign/${contract.signToken}`,
      payload: {
        signerName: 'Jane Prop',
        agreement: true,
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'SIGNED');
    assert.ok(body.signedAt);
    assert.equal(body.clientSigName, 'Jane Prop');
    assert.ok(body.signedContentHash);
    console.log(`  ✓ Signed contract`);
  });

  test('signed contract link is revoked and record remains available to tenant', async () => {
    const contract = await rawPrisma.contract.findUnique({ where: { id: createdContractId } });
    const publicRes = await fastify.inject({ method: 'GET', url: `/api/contracts/sign/${contract.signToken}` });
    assert.equal(publicRes.statusCode, 410);
    const tenantRes = await fastify.inject({ method: 'GET', url: `/api/contracts/${createdContractId}`, headers: authHeaders() });
    assert.equal(tenantRes.statusCode, 200);
    assert.equal(JSON.parse(tenantRes.body).signedContentHash, contract.signedContentHash);
  });

  test('POST /api/contracts/:id/void — void a draft contract', async () => {
    // Create a new draft to void
    const createRes = await fastify.inject({
      method: 'POST',
      url: '/api/contracts',
      headers: authHeaders(),
      payload: {
        title: 'To Be Voided',
        content: '<p>Test</p>',
        templateType: 'RETAINER',
        clientId: testClientId,
      },
    });
    assert.equal(createRes.statusCode, 200, `Expected draft creation to succeed: ${createRes.body}`);
    const draftId = JSON.parse(createRes.body).id;

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/contracts/${draftId}/void`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'VOID');
    console.log(`  ✓ Voided draft contract`);
  });

});
