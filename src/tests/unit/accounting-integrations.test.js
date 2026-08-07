import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';
import integrationRoutes from '../../routes/integration.routes.js';

describe('deferred accounting integrations', () => {
  let app;
  let findManyArgs;
  let databaseCalls;

  before(async () => {
    app = Fastify();
    app.decorate('authenticate', async () => {});
    app.addHook('onRequest', async (request) => {
      request.organizationId = 'org-a';
      request.prisma = {
        integration: {
          findMany: async (args) => {
            findManyArgs = args;
            databaseCalls += 1;
            return [];
          },
          findFirst: async () => {
            databaseCalls += 1;
            return null;
          },
          upsert: async () => {
            databaseCalls += 1;
            throw new Error('placeholder writes must never occur');
          },
          update: async () => {
            databaseCalls += 1;
            throw new Error('fake sync writes must never occur');
          },
        },
      };
    });
    await app.register(integrationRoutes, { prefix: '/api/integrations' });
    await app.ready();
  });

  after(async () => app.close());

  test('list query excludes legacy QuickBooks and Xero records', async () => {
    databaseCalls = 0;
    const response = await app.inject({ method: 'GET', url: '/api/integrations' });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(findManyArgs.where.type.notIn.sort(), ['QUICKBOOKS', 'XERO']);
    assert.equal(databaseCalls, 1);
  });

  for (const provider of ['quickbooks', 'xero']) {
    for (const action of ['connect', 'sync', 'disconnect']) {
      test(`${provider} ${action} is truthful and performs no database write`, async () => {
        databaseCalls = 0;
        const response = await app.inject({
          method: 'POST',
          url: `/api/integrations/${provider}/${action}`,
        });

        assert.equal(response.statusCode, 501);
        assert.equal(response.json().code, 'ACCOUNTING_INTEGRATION_UNAVAILABLE');
        assert.match(response.json().message, /No authorization or synchronization was performed/);
        assert.equal(databaseCalls, 0);
      });
    }
  }

  test('provider status cannot surface a legacy demo connection', async () => {
    databaseCalls = 0;
    const response = await app.inject({ method: 'GET', url: '/api/integrations/quickbooks' });

    assert.equal(response.statusCode, 501);
    assert.equal(response.json().code, 'ACCOUNTING_INTEGRATION_UNAVAILABLE');
    assert.equal(databaseCalls, 0);
  });
});
