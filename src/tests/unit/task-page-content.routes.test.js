import assert from 'node:assert/strict';
import test from 'node:test';
import taskRoutes from '../../routes/task.routes.js';
import { taskPageContentUpdateSchema, TASK_CONTENT_MAX_BYTES } from '../../validators/schemas.js';

async function contentRoute() {
  let route;
  const noop = () => {};
  const fastify = {
    authenticate: async () => {},
    get: noop,
    post: noop,
    patch: noop,
    delete: noop,
    put(path, options, handler) {
      if (path === '/:id/content') route = { options, handler };
    },
  };
  await taskRoutes(fastify);
  return route;
}

function fakeReply() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.payload = payload; return this; },
  };
}

const blocks = [
  { type: 'heading1', content: 'Launch plan' },
  { type: 'todo', content: 'Send dieline', checked: false },
];

test('PUT /tasks/:id/content accepts the editor block array and stores it as JSON', async () => {
  const { options, handler } = await contentRoute();
  const request = { params: { id: 'task-1' }, body: { content: blocks } };
  const reply = fakeReply();
  await options.preHandler(request, reply);
  assert.equal(reply.statusCode, 200, JSON.stringify(reply.payload));

  let updateArgs;
  request.prisma = { task: { update: async (args) => { updateArgs = args; return { id: 'task-1' }; } } };
  await handler(request, fakeReply());
  assert.deepEqual(JSON.parse(updateArgs.data.content), blocks);
});

test('PUT /tasks/:id/content rejects a pre-serialised string and unknown block types', async () => {
  const { options } = await contentRoute();
  for (const content of ['[{"type":"paragraph"}]', [{ type: 'script', content: 'x' }]]) {
    const reply = fakeReply();
    await options.preHandler({ params: { id: 'task-1' }, body: { content } }, reply);
    assert.equal(reply.statusCode, 400);
  }
});

test('task content is size-capped and allows clearing the cover image', () => {
  const huge = Array.from({ length: 20 }, () => ({ type: 'paragraph', content: 'x'.repeat(19_000) }));
  assert.ok(JSON.stringify(huge).length > TASK_CONTENT_MAX_BYTES);
  assert.equal(taskPageContentUpdateSchema.safeParse({ content: huge }).success, false);
  assert.equal(taskPageContentUpdateSchema.safeParse({ coverImage: null }).success, true);
  assert.equal(taskPageContentUpdateSchema.safeParse({ title: 'Renamed' }).success, true);
});
