import test from 'node:test';
import assert from 'node:assert/strict';
import ashChatRoutes from '../../routes/ash-chat.routes.js';

test('lists Ash chat conversations with the request-scoped Prisma client', async () => {
  let listHandler;
  const fastify = {
    authenticate: async () => {},
    get(path, _options, handler) {
      if (path === '/conversations') listHandler = handler;
    },
    post() {},
    delete() {},
  };

  await ashChatRoutes(fastify);
  const result = await listHandler({
    prisma: {
      ashConversation: {
        findMany: async () => [{
          id: 'conversation-1',
          title: null,
          createdAt: new Date('2026-08-21T00:00:00.000Z'),
          updatedAt: new Date('2026-08-21T01:00:00.000Z'),
          messages: [{ content: 'Most recent message' }],
        }],
      },
    },
  });

  assert.deepEqual(result.map(({ createdAt, updatedAt, ...conversation }) => conversation), [{
    id: 'conversation-1',
    title: 'New conversation',
    lastMessage: 'Most recent message',
  }]);
});
