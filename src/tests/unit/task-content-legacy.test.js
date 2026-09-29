import assert from 'node:assert/strict';
import test from 'node:test';
import taskRoutes from '../../routes/task.routes.js';
import { parseTaskContent } from '../../utils/taskContent.js';

test('stored block arrays keep their blocks, with content coerced to strings', () => {
  assert.deepEqual(parseTaskContent(JSON.stringify([
    { type: 'heading1', content: 'Brief' },
    { type: 'paragraph', content: null },
    { type: 'paragraph', content: 42 },
    { type: 'todo', checked: true },
    7,
  ])), [
    { type: 'heading1', content: 'Brief' },
    { type: 'paragraph', content: '' },
    { type: 'paragraph', content: '42' },
    { type: 'todo', checked: true, content: '' },
    { type: 'paragraph', content: '7' },
  ]);
});

test('legacy scalar, object and plain-text rows become one paragraph with the original value', () => {
  assert.deepEqual(parseTaskContent(null), []);
  assert.deepEqual(parseTaskContent(''), []);
  assert.deepEqual(parseTaskContent('null'), []);
  assert.deepEqual(parseTaskContent('Just some notes'), [{ type: 'paragraph', content: 'Just some notes' }]);
  assert.deepEqual(parseTaskContent('"quoted text"'), [{ type: 'paragraph', content: 'quoted text' }]);
  assert.deepEqual(parseTaskContent('12'), [{ type: 'paragraph', content: '12' }]);
  assert.deepEqual(parseTaskContent('true'), [{ type: 'paragraph', content: 'true' }]);
  assert.deepEqual(parseTaskContent('{"brief":"hero"}'), [{ type: 'paragraph', content: '{"brief":"hero"}' }]);
});

test('GET /tasks/:id/page returns normalised blocks for a legacy object row', async () => {
  let handler;
  const noop = () => {};
  await taskRoutes({
    authenticate: async () => {},
    get(path, options, routeHandler) { if (path === '/:id/page') handler = routeHandler; },
    post: noop, put: noop, patch: noop, delete: noop,
  });
  const page = await handler({
    params: { id: 'task-1' },
    prisma: { task: { findUnique: async () => ({ id: 'task-1', title: 'Legacy', content: '{"brief":"hero"}', properties: null }) } },
  }, { status() { return this; }, send(x) { return x; } });
  assert.deepEqual(page.content, [{ type: 'paragraph', content: '{"brief":"hero"}' }]);
});
