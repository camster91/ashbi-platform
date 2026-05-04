/**
 * Client Routes Unit Tests
 * 
 * Tests the business logic of client routes using a mocked Prisma client.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import clientRoutes from '../routes/client.routes.js';

describe('Client Routes (Unit)', () => {
  let fastify;
  let mockPrisma;

  beforeEach(async () => {
    fastify = Fastify();
    
    // Mock authentication
    fastify.decorate('authenticate', async (request, reply) => {
      request.user = { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' };
    });

    // Mock Prisma
    mockPrisma = {
      client: {
        findMany: async () => [],
        count: async () => 0,
        findUnique: async () => null,
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
      }
    };
    
    fastify.decorate('prisma', mockPrisma);
    
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
});
