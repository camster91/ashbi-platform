/**
 * Client Routes Unit Tests
 * 
 * Tests the business logic of client routes using a mocked Prisma client.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import clientRoutes from '../../routes/client.routes.js';

describe('Client Routes (Unit)', () => {
  let fastify;
  let mockPrisma;

  beforeEach(async () => {
    fastify = Fastify();

    // Register necessary plugins
    await fastify.register(cookie);
    await fastify.register(jwt, { secret: 'test-secret', cookie: { cookieName: 'token', signed: false } });
    
    // Mock authentication
    fastify.decorate('authenticate', async (request, reply) => {
      request.user = { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' };
    });

    // Mock adminOnly, if used
    fastify.decorate('adminOnly', async (request, reply) => {
        if (request.user?.role !== 'ADMIN') {
            return reply.status(403).send({ error: 'Admin access required' });
        }
    });

    // Mock Prisma
    mockPrisma = {
      client: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
        findFirst: async () => null,
        create: async ({ data }) => ({ id: 'new-client', ...data }),
        update: async ({ where, data }) => ({ id: where.id, ...data }),
        updateMany: async () => ({ count: 0 })
      },
      contact: {
        findMany: async () => [],
        create: async ({ data }) => ({ id: 'new-contact', ...data }),
        updateMany: async () => ({ count: 0 })
      },
      thread: {
        findMany: async () => []
      },
      invoice: {
        findMany: async () => []
      }
    };
    
    fastify.decorate('prisma', mockPrisma);
    
    // Inject mock prisma into request (production does this via tenancyMiddleware preHandler hook)
    fastify.addHook('preHandler', async (request) => {
      request.prisma = mockPrisma;
    });
    
    // Register routes
    await fastify.register(clientRoutes);
  });

  test('GET / should return empty list when no clients exist', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.clients, []);
    assert.equal(body.total, 0);
  });

  test('POST / should create a new client', async () => {
    const newClient = { name: 'Acme Corp', domain: 'acme.com' };
    
    const res = await fastify.inject({
      method: 'POST',
      url: '/',
      payload: newClient
    });

    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Acme Corp');
    assert.equal(body.domain, 'acme.com');
  });

  test('GET /:id should return 404 if client not found', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/non-existent'
    });

    assert.equal(res.statusCode, 404);
  });

  test('GET /:id should return client with calculated revenue', async () => {
    // Override mock for this test
    mockPrisma.client.findUnique = async () => ({
      id: 'client-1',
      name: 'Client One',
      invoices: [
        { status: 'PAID', total: 1000 },
        { status: 'PAID', total: 500 },
        { status: 'SENT', total: 200 }
      ]
    });

    const res = await fastify.inject({
      method: 'GET',
      url: '/client-1'
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.totalRevenue, 1500);
    assert.equal(body.outstandingBalance, 200);
  });

  test('POST /:id/contacts should unset existing primary if new one is primary', async () => {
    let updateManyCalled = false;
    mockPrisma.contact.updateMany = async () => {
      updateManyCalled = true;
      return { count: 1 };
    };

    const res = await fastify.inject({
      method: 'POST',
      url: '/client-1/contacts',
      payload: {
        name: 'John Doe',
        email: 'john@example.com',
        isPrimary: true
      }
    });

    assert.equal(res.statusCode, 201);
    assert.ok(updateManyCalled, 'Should have unset other primary contacts');
  });

  test('POST / stores an empty or blank domain as null and skips the duplicate check', async () => {
    let lookups = 0;
    mockPrisma.client.findFirst = async () => { lookups += 1; return { id: 'other' }; };
    for (const domain of ['', '   ']) {
      const res = await fastify.inject({ method: 'POST', url: '/', payload: { name: 'No Domain', domain } });
      assert.equal(res.statusCode, 201, res.body);
      assert.equal(JSON.parse(res.body).domain, null);
    }
    assert.equal(lookups, 0);
  });

  test('POST / trims and lowercases the domain and lowercases contact emails', async () => {
    let lookedUp;
    mockPrisma.client.findFirst = async ({ where }) => { lookedUp = where; return null; };
    mockPrisma.client.create = async ({ data }) => ({ id: 'new-client', ...data, contacts: data.contacts?.create });
    const res = await fastify.inject({
      method: 'POST',
      url: '/',
      payload: { name: 'Acme', domain: '  Acme.COM ', contacts: [{ name: 'Jane', email: 'Jane.Doe@Acme.COM' }] },
    });
    assert.equal(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.domain, 'acme.com');
    assert.deepEqual(lookedUp, { domain: 'acme.com' });
    assert.equal(body.contacts[0].email, 'jane.doe@acme.com');
  });

  test('POST / answers 409 for a domain the organization already uses', async () => {
    mockPrisma.client.findFirst = async () => ({ id: 'existing' });
    const res = await fastify.inject({ method: 'POST', url: '/', payload: { name: 'Dup', domain: 'acme.com' } });
    assert.equal(res.statusCode, 409);
  });

  test('PUT /:id clears a blank domain to null and refuses a duplicate with 409', async () => {
    const cleared = await fastify.inject({ method: 'PUT', url: '/client-1', payload: { domain: ' ' } });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.equal(JSON.parse(cleared.body).domain, null);

    let lookedUp;
    mockPrisma.client.findFirst = async ({ where }) => { lookedUp = where; return { id: 'client-2' }; };
    const dup = await fastify.inject({ method: 'PUT', url: '/client-1', payload: { domain: 'Acme.com' } });
    assert.equal(dup.statusCode, 409);
    assert.deepEqual(lookedUp, { domain: 'acme.com', id: { not: 'client-1' } });
  });

  test('POST /:id/contacts stores the email trimmed and lowercased', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/client-1/contacts',
      payload: { name: 'Jane', email: 'Jane.Doe@Example.COM' },
    });
    assert.equal(res.statusCode, 201, res.body);
    assert.equal(JSON.parse(res.body).email, 'jane.doe@example.com');
  });
});
