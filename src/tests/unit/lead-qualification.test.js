import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  convertQualifiedLead,
  updateLeadQualification,
} from '../../services/lead-qualification.service.js';

test('qualification update records the human decision and a durable event atomically', async () => {
  const writes = { updates: [], events: [] };
  const transaction = {
    lead: {
      findFirst: async () => ({ id: 'lead-1', status: 'NEW', convertedClientId: null }),
      update: async ({ data }) => {
        writes.updates.push(data);
        return { id: 'lead-1', status: data.status, qualificationNotes: data.qualificationNotes };
      },
    },
    leadEvent: { create: async ({ data }) => writes.events.push(data) },
  };
  const now = new Date('2026-08-26T21:00:00.000Z');

  const result = await updateLeadQualification({
    prisma: { $transaction: async (operation) => operation(transaction) },
    leadId: 'lead-1',
    status: 'QUALIFIED',
    qualificationNotes: 'Strong fit for a human-led packaging and commerce engagement.',
    actorUserId: 'user-1',
    now,
  });

  assert.equal(result.status, 'QUALIFIED');
  assert.equal(writes.updates[0].qualifiedAt, now);
  assert.equal(writes.events[0].eventName, 'qualification_updated');
  assert.deepEqual(writes.events[0].properties, {
    fromStatus: 'NEW',
    toStatus: 'QUALIFIED',
    actorUserId: 'user-1',
  });
  assert.equal(JSON.stringify(writes.events[0]).includes('Strong fit'), false);
});

test('qualification update refuses to reopen a converted lead', async () => {
  const transaction = {
    lead: { findFirst: async () => ({ id: 'lead-1', status: 'CONVERTED', convertedClientId: 'client-1' }) },
  };

  await assert.rejects(
    updateLeadQualification({
      prisma: { $transaction: async (operation) => operation(transaction) },
      leadId: 'lead-1',
      status: 'NURTURE',
      actorUserId: 'user-1',
    }),
    (error) => error.code === 'LEAD_ALREADY_CONVERTED',
  );
});

test('qualified lead conversion creates one client and primary contact, then links the lead', async () => {
  const writes = { clients: [], contacts: [], leadUpdates: [], events: [] };
  const transaction = {
    lead: {
      findFirst: async () => ({
        id: 'lead-1', status: 'QUALIFIED', convertedClientId: null,
        name: 'Casey Founder', email: 'casey@example.com', company: 'Example Foods',
        phone: '416-555-0100', serviceLine: 'brand_packaging',
      }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => { writes.leadUpdates.push(data); return { id: 'lead-1', ...data }; },
    },
    contact: { findFirst: async () => null, create: async ({ data }) => { writes.contacts.push(data); return { id: 'contact-1', ...data }; } },
    client: { create: async ({ data }) => { writes.clients.push(data); return { id: 'client-1', ...data }; } },
    leadEvent: { create: async ({ data }) => writes.events.push(data) },
  };
  const now = new Date('2026-08-26T21:30:00.000Z');

  const result = await convertQualifiedLead({
    prisma: { $transaction: async (operation) => operation(transaction) },
    leadId: 'lead-1',
    actorUserId: 'user-1',
    now,
  });

  assert.deepEqual(result, { leadId: 'lead-1', clientId: 'client-1', idempotent: false, reusedClient: false });
  assert.equal(writes.clients.length, 1);
  assert.deepEqual(writes.clients[0], {
    name: 'Example Foods', email: 'casey@example.com', status: 'ACTIVE',
    contactPerson: 'Casey Founder', phone: '416-555-0100',
    serviceType: 'brand_packaging', relationshipStatus: 'ACTIVE',
  });
  assert.deepEqual(writes.contacts[0], {
    email: 'casey@example.com', name: 'Casey Founder', isPrimary: true, clientId: 'client-1',
  });
  assert.equal(writes.leadUpdates[0].status, 'CONVERTED');
  assert.equal(writes.leadUpdates[0].convertedClientId, 'client-1');
  assert.equal(writes.leadUpdates[0].convertedAt, now);
  assert.equal(writes.events[0].eventName, 'lead_converted');
});

test('lead conversion reuses an existing tenant client matched by contact email', async () => {
  let clientCreates = 0;
  let contactCreates = 0;
  let contactLookup;
  const transaction = {
    lead: {
      findFirst: async () => ({
        id: 'lead-1', status: 'QUALIFIED', convertedClientId: null,
        name: 'Casey Founder', email: 'casey@example.com', company: 'Example Foods',
        phone: null, serviceLine: 'web_commerce',
      }),
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => ({ id: 'lead-1', ...data }),
    },
    contact: {
      findFirst: async (args) => {
        contactLookup = args;
        return { id: 'contact-existing', clientId: 'client-existing' };
      },
      create: async () => { contactCreates += 1; },
    },
    client: { create: async () => { clientCreates += 1; } },
    leadEvent: { create: async () => ({}) },
  };

  const result = await convertQualifiedLead({
    prisma: { $transaction: async (operation) => operation(transaction) },
    leadId: 'lead-1',
    actorUserId: 'user-1',
  });

  assert.deepEqual(result, { leadId: 'lead-1', clientId: 'client-existing', idempotent: false, reusedClient: true });
  assert.equal(clientCreates, 0);
  assert.equal(contactCreates, 0);
  assert.deepEqual(contactLookup.where, {
    email: { equals: 'casey@example.com', mode: 'insensitive' },
  });
});

test('replaying or racing a completed conversion returns the linked client without duplicate writes', async () => {
  let updateManyCalls = 0;
  const alreadyConverted = {
    lead: {
      findFirst: async () => ({ id: 'lead-1', status: 'CONVERTED', convertedClientId: 'client-existing' }),
      updateMany: async () => { updateManyCalls += 1; },
    },
  };

  const replay = await convertQualifiedLead({
    prisma: { $transaction: async (operation) => operation(alreadyConverted) },
    leadId: 'lead-1',
    actorUserId: 'user-1',
  });

  assert.deepEqual(replay, { leadId: 'lead-1', clientId: 'client-existing', idempotent: true, reusedClient: true });
  assert.equal(updateManyCalls, 0);

  let reads = 0;
  const race = {
    lead: {
      findFirst: async () => {
        reads += 1;
        return reads === 1
          ? { id: 'lead-1', status: 'QUALIFIED', convertedClientId: null }
          : { id: 'lead-1', status: 'CONVERTED', convertedClientId: 'client-race-winner' };
      },
      updateMany: async () => ({ count: 0 }),
    },
  };
  const raced = await convertQualifiedLead({
    prisma: { $transaction: async (operation) => operation(race) },
    leadId: 'lead-1',
    actorUserId: 'user-1',
  });
  assert.deepEqual(raced, { leadId: 'lead-1', clientId: 'client-race-winner', idempotent: true, reusedClient: true });
});

test('lead schema and routes expose a tenant-safe human qualification workflow', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  const migration = fs.readFileSync(path.join(process.cwd(), 'prisma', 'migrations', '20260826173000_public_client_acquisition_intake', 'migration.sql'), 'utf8');
  const routes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'client-acquisition.routes.js'), 'utf8');
  const model = schema.match(/model Lead \{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(model, /qualificationNotes\s+String\?/);
  assert.match(model, /qualifiedAt\s+DateTime\?/);
  assert.match(model, /convertedClientId\s+String\?/);
  assert.match(model, /convertedClient\s+Client\?/);
  assert.match(migration, /"qualificationNotes" TEXT/);
  assert.match(migration, /"convertedClientId" TEXT/);
  assert.match(routes, /fastify\.get\('\/leads'/);
  assert.match(routes, /fastify\.patch\('\/leads\/:id\/qualification'/);
  assert.match(routes, /fastify\.post\('\/leads\/:id\/convert'/);
  assert.match(routes, /request\.prisma/);
  assert.doesNotMatch(routes, /fastify\.prisma\.lead\.(?:find|update|create)/);
});
