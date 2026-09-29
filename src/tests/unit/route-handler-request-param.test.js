// Regression: several GET handlers referenced `request` without declaring it
// as a handler parameter, so every call threw a ReferenceError (HTTP 500).
// `no-undef` is now enabled in the backend lint config to catch this class of
// bug statically; these inject tests pin the runtime behaviour per route.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

const { default: templateRoutes } = await import('../../routes/template.routes.js');
const { default: settingsRoutes } = await import('../../routes/settings.routes.js');
const { default: aiContextRoutes } = await import('../../routes/ai-context.routes.js');
const { default: ashChatRoutes } = await import('../../routes/ash-chat.routes.js');

const USER = { id: 'user-1', role: 'ADMIN', organizationId: 'org-1' };

async function buildApp(t, plugin, fakePrisma) {
  const app = Fastify({ logger: false });
  const signIn = async (request) => {
    request.user = USER;
    request.prisma = fakePrisma;
  };
  app.decorate('authenticate', signIn);
  app.decorate('adminOnly', signIn);
  await app.register(plugin);
  t.after(() => app.close());
  return app;
}

describe('GET handlers receive the request they read from', () => {
  it('GET /api/templates lists task templates via request.prisma', async (t) => {
    const app = await buildApp(t, templateRoutes, {
      taskTemplate: {
        findMany: async () => [{ id: 'tt-1', name: 'Launch', tasks: '[{"title":"Kickoff"}]' }],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), [{ id: 'tt-1', name: 'Launch', tasks: [{ title: 'Kickoff' }] }]);
  });

  it('GET /api/settings/assignment-rules lists rules via request.prisma', async (t) => {
    const app = await buildApp(t, settingsRoutes, {
      assignmentRule: {
        findMany: async () => [{ id: 'r-1', name: 'Default', priority: 1, conditions: '{"a":1}' }],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/assignment-rules' });
    assert.equal(res.statusCode, 200, res.body);
    const [rule] = res.json();
    assert.equal(rule.id, 'r-1');
    assert.equal(rule.name, 'Default');
  });

  it('GET /api/ai-context and /api/ai-context/prompt read via request.prisma', async (t) => {
    const rows = [{ key: 'brand_voice', value: 'Direct' }];
    const app = await buildApp(t, aiContextRoutes, {
      aiContext: { findMany: async () => rows },
    });
    const list = await app.inject({ method: 'GET', url: '/' });
    assert.equal(list.statusCode, 200, list.body);
    assert.deepEqual(list.json(), rows);

    const prompt = await app.inject({ method: 'GET', url: '/prompt' });
    assert.equal(prompt.statusCode, 200, prompt.body);
    assert.deepEqual(prompt.json(), {
      prompt: '[BRAND VOICE]: Direct',
      context: { brand_voice: 'Direct' },
    });
  });

  it('GET /api/ash-chat/conversations lists conversations via request.prisma', async (t) => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const app = await buildApp(t, ashChatRoutes, {
      ashConversation: {
        findMany: async () => [{
          id: 'c-1', title: null, createdAt: now, updatedAt: now,
          messages: [{ content: 'hello there' }],
        }],
      },
    });
    const res = await app.inject({ method: 'GET', url: '/conversations' });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(res.json(), [{
      id: 'c-1',
      title: 'New conversation',
      lastMessage: 'hello there',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }]);
  });
});
