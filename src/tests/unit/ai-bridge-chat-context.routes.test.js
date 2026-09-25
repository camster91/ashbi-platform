import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import aiBridgeRoutes from '../../routes/ai-bridge.routes.js';

test('supplies bounded tenant-scoped conversation and retainer context to the AI bridge', async (t) => {
  let chatRequest;
  const app = Fastify();
  app.decorate('prisma', {
    project: { findMany: async () => [{ id: 'project-1', name: 'Website', status: 'ACTIVE', health: 'ON_TRACK' }] },
    task: { findMany: async () => [{ id: 'task-1', title: 'Review homepage', status: 'IN_PROGRESS', priority: 'HIGH', dueDate: null, project: { name: 'Website' } }] },
    client: { findMany: async () => [{ id: 'client-1', name: 'Acme', status: 'ACTIVE', domain: 'acme.test' }] },
    chatMessage: { findMany: async () => [{
      id: 'message-1', content: 'The client approved the revised homepage.', type: 'TEXT', externalSource: 'SLACK', externalAuthorName: 'Avery', createdAt: new Date('2026-08-13T18:00:00.000Z'),
      project: { name: 'Website' }, author: null,
    }] },
    retainerPlan: { findMany: async () => [{
      id: 'retainer-1', tier: 'STANDARD', hoursPerMonth: 20, hoursUsed: 6, currency: 'USD', retainerStatus: 'ACTIVE', nextBillingDate: new Date('2026-09-01T00:00:00.000Z'),
      client: { name: 'Acme' },
    }] },
  });
  app.decorate('authenticateWithApiKey', async (request) => {
    request.user = { id: 'user-1', organizationId: 'org-1', role: 'TEAM' };
    request.apiKeyScopes = ['ai_bridge:read', 'ai_bridge:actions'];
  });
  app.addHook('preHandler', async (request) => { request.prisma = app.prisma; });
  await app.register(aiBridgeRoutes, {
    chatClient: {
      chat: async (input) => {
        chatRequest = input;
        return 'Context received.';
      },
    },
  });
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST', url: '/v1/chat/completions',
    payload: { messages: [{ role: 'user', content: 'What changed for Acme?' }] },
  });

  assert.equal(response.statusCode, 200);
  const context = JSON.parse(chatRequest.system.split('Organization context:\n')[1]);
  assert.deepEqual(context.recentConversations, [{
    id: 'message-1', content: 'The client approved the revised homepage.', type: 'TEXT', source: 'SLACK', author: 'Avery', createdAt: '2026-08-13T18:00:00.000Z', project: 'Website',
  }]);
  assert.deepEqual(context.retainers, [{
    id: 'retainer-1', client: 'Acme', tier: 'STANDARD', hoursPerMonth: 20, hoursUsed: 6, currency: 'USD', status: 'ACTIVE', nextBillingDate: '2026-09-01T00:00:00.000Z',
  }]);
});
