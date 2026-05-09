// Proposal + Contract tests — Node.js built-in test runner
// Run: node --test src/tests/proposal-contract.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import proposalRoutes from '../routes/proposal.routes.js';
import contractRoutes from '../routes/contract.routes.js';

const prisma = new PrismaClient();
let fastify;
let authToken;
let testClientId;
let testProjectId;
let testUserId;
let createdProposalId;
let createdContractId;

before(async () => {
  fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, { secret: 'test-secret', cookie: { cookieName: 'token', signed: false } });

  fastify.decorate('prisma', prisma);
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

  await fastify.register(proposalRoutes, { prefix: '/api/proposals' });
  await fastify.register(contractRoutes, { prefix: '/api/contracts' });
  await fastify.ready();

  const user = await prisma.user.upsert({
    where: { email: 'test-proposal@ashbi.ca' },
    update: {},
    create: { email: 'test-proposal@ashbi.ca', name: 'Test Prop User', password: 'hashed', role: 'ADMIN' }
  });
  testUserId = user.id;

  const client = await prisma.client.create({
    data: {
      name: 'Test Client — Proposal Suite',
      contacts: { create: [{ name: 'Jane Prop', email: 'jane@proptest.com', isPrimary: true }] }
    }
  });
  testClientId = client.id;

  const project = await prisma.project.create({
    data: { name: 'Test Project — Proposals', clientId: testClientId }
  });
  testProjectId = project.id;

  authToken = fastify.jwt.sign({ id: user.id, email: user.email, role: 'ADMIN' });
});

after(async () => {
  await prisma.contract.deleteMany({ where: { clientId: testClientId } });
  await prisma.proposalLineItem.deleteMany({ where: { proposal: { clientId: testClientId } } });
  await prisma.proposal.deleteMany({ where: { clientId: testClientId } });
  await prisma.task.deleteMany({ where: { projectId: testProjectId } });
  await prisma.project.delete({ where: { id: testProjectId } });
  await prisma.contact.deleteMany({ where: { clientId: testClientId } });
  await prisma.client.delete({ where: { id: testClientId } });
  await prisma.user.delete({ where: { id: testUserId } });
  await prisma.$disconnect();
  await fastify.close();
});

function authHeaders() {
  return { Authorization: `Bearer ${authToken}` };
}

// ── Proposals ──────────────────────────────────────────────────────────────

describe('Proposal CRUD', () => {

  test('POST /api/proposals — create proposal with line items', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/proposals',
      headers: authHeaders(),
      payload: {
        title: 'Brand Redesign Proposal',
        clientId: testClientId,
        projectId: testProjectId,
        validUntil: '2026-06-30',
        notes: 'Includes 2 revision rounds',
        lineItems: [
          { description: 'Brand Strategy', quantity: 1, unitPrice: 5000, total: 5000 },
          { description: 'Visual Identity', quantity: 1, unitPrice: 3000, total: 3000 },
        ],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
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
    console.log(`  ✓ Sent proposal`);
  });

  test('POST /api/proposals/:id/approve — approve proposal', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/proposals/${createdProposalId}/approve`,
      headers: authHeaders(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'APPROVED');
    assert.ok(body.approvedAt);
    console.log(`  ✓ Approved proposal`);
  });

});

// ── Contracts ──────────────────────────────────────────────────────────────

describe('Contract CRUD', () => {

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

  test('POST /api/contracts/:id/sign — sign contract', async () => {
    const contract = await prisma.contract.findUnique({ where: { id: createdContractId } });

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/contracts/${createdContractId}/sign`,
      payload: {
        signToken: contract.signToken,
        clientSigName: 'Jane Prop',
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'SIGNED');
    assert.ok(body.signedAt);
    assert.equal(body.clientSigName, 'Jane Prop');
    console.log(`  ✓ Signed contract`);
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
        templateType: 'NDA',
        clientId: testClientId,
      },
    });
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