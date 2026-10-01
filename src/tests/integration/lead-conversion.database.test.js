// Lead -> client conversion (PATCH /api/leads/leads/:id/convert) against a
// real PostgreSQL schema, through the tenant-scoped Prisma client as in
// production: the client lands in the caller's organization, consumer
// mailbox domains (gmail.com) are never stored, and a second lead from a
// company domain the organization already has links to that client instead
// of failing on the per-organization unique domain.
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import leadRoutes from '../../routes/leads.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('lead conversion stays in the caller organization and never stores a consumer domain', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgs = { a: `lead-org-a-${suffix}`, b: `lead-org-b-${suffix}` };
  const company = `acme-${suffix}.example`;
  let app;
  try {
    await raw.organization.createMany({ data: [
      { id: orgs.a, name: 'Lead org A', slug: `lead-a-${suffix}` },
      { id: orgs.b, name: 'Lead org B', slug: `lead-b-${suffix}` },
    ] });
    // Org B already uses the company domain; org A must neither see nor link to it.
    await raw.client.create({ data: { organizationId: orgs.b, name: 'B Acme', domain: company } });
    const lead = (id, org, senderEmail, meta) => raw.unmatchedEmail.create({ data: {
      id: `${id}-${suffix}`, organizationId: org, senderEmail, senderName: id, subject: 'Hi', bodyText: 'Hello',
      suggestedClients: meta ? JSON.stringify(meta) : null,
    } });
    await lead('gmail1', orgs.a, `bob.${suffix}@gmail.com`, { company: 'Bob Co' });
    await lead('gmail2', orgs.a, `mary.${suffix}@GMail.com`, null);
    await lead('acme1', orgs.a, `Jane.${suffix}@${company.toUpperCase()}`, { company: 'Acme' });
    await lead('acme2', orgs.a, `joe.${suffix}@${company}`, { company: 'Acme again' });
    await lead('other', orgs.b, `x.${suffix}@elsewhere.example`, null);

    app = Fastify({ logger: false });
    app.decorate('authenticate', async (request) => {
      request.user = { id: `admin-${suffix}`, role: 'ADMIN', organizationId: orgs.a };
    });
    app.addHook('onRequest', async (request) => { request.prisma = createScopedPrisma(raw, orgs.a); });
    await app.register(leadRoutes, { prefix: '/api/leads' });
    await app.ready();
    const convert = (id) => app.inject({ method: 'PATCH', url: `/api/leads/leads/${id}-${suffix}/convert` });

    const list = await app.inject({ method: 'GET', url: '/api/leads/leads' });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json().map((row) => row.organizationId).filter((org) => org !== orgs.a), [], 'only this organization\'s leads');
    assert.equal((await convert('other')).statusCode, 404, 'another organization\'s lead is not found');

    // Consumer domains: a client without a domain, twice, without a conflict.
    for (const id of ['gmail1', 'gmail2']) {
      const response = await convert(id);
      assert.equal(response.statusCode, 200, response.body);
      const { client, contact, linkedExistingClient } = response.json();
      assert.equal(client.organizationId, orgs.a);
      assert.equal(client.domain, null, 'gmail.com is never stored as a client domain');
      assert.equal(linkedExistingClient, false);
      assert.equal(contact.isPrimary, true);
      assert.equal(contact.email, contact.email.toLowerCase());
    }

    // A company domain: org A gets its own client (org B's is not linked).
    const first = await convert('acme1');
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().client.organizationId, orgs.a);
    assert.equal(first.json().client.domain, company);
    assert.equal(first.json().client.name, 'Acme');

    // A second lead from that domain links to the same client: no 409/500.
    const second = await convert('acme2');
    assert.equal(second.statusCode, 200, second.body);
    assert.equal(second.json().linkedExistingClient, true);
    assert.equal(second.json().client.id, first.json().client.id);
    assert.equal(second.json().contact.isPrimary, false);
    assert.equal(second.json().contact.clientId, first.json().client.id);

    // Already resolved.
    assert.equal((await convert('acme2')).statusCode, 400);

    const clientsA = await raw.client.findMany({ where: { organizationId: orgs.a } });
    assert.equal(clientsA.length, 3);
    assert.equal((await raw.client.findMany({ where: { organizationId: orgs.b } })).length, 1, 'org B untouched');
    assert.equal((await raw.unmatchedEmail.findUnique({ where: { id: `other-${suffix}` } })).status, 'PENDING');
  } finally {
    await app?.close();
    await raw.contact.deleteMany({ where: { client: { organizationId: { in: Object.values(orgs) } } } });
    await raw.client.deleteMany({ where: { organizationId: { in: Object.values(orgs) } } });
    await raw.unmatchedEmail.deleteMany({ where: { organizationId: { in: Object.values(orgs) } } });
    await purgeFixtureAuditEvents(raw, { ids: Object.values(orgs) });
    await raw.organization.deleteMany({ where: { id: { in: Object.values(orgs) } } });
    await raw.$disconnect();
  }
});
