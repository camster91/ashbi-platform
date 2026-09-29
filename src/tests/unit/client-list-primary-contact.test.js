import assert from 'node:assert/strict';
import test from 'node:test';
import clientRoutes from '../../routes/client.routes.js';

test('GET /clients includes the primary contact for the list Contact column', async () => {
  let handler;
  const noop = () => {};
  await clientRoutes({
    authenticate: async () => {},
    get(path, options, routeHandler) { if (path === '/') handler = routeHandler; },
    post: noop, put: noop, patch: noop, delete: noop,
  });
  let args;
  await handler({
    query: {},
    prisma: {
      client: {
        findMany: async (a) => { args = a; return []; },
        count: async () => 0,
      },
    },
  });
  assert.equal(args.include.contacts.take, 1);
  assert.deepEqual(args.include.contacts.orderBy[0], { isPrimary: 'desc' });
  assert.equal(args.include.contacts.select.email, true);
  assert.equal(args.include.contacts.select.name, true);
});
