import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createClientSchema, taskCreateQuickSchema } from '../../validators/schemas.js';

const clientRoutes = readFileSync(new URL('../../routes/client.routes.js', import.meta.url), 'utf8');
const taskRoutes = readFileSync(new URL('../../routes/task.routes.js', import.meta.url), 'utf8');

test('quick client schema preserves a bounded primary contact', () => {
  const result = createClientSchema.safeParse({
    name: 'Acme',
    contacts: [{ name: 'Acme', email: 'owner@example.com', isPrimary: true }],
  });
  assert.equal(result.success, true);
  assert.equal(result.data.contacts[0].email, 'owner@example.com');
  assert.equal(result.data.contacts[0].isPrimary, true);
});

test('client creation persists contacts atomically instead of discarding email', () => {
  assert.match(clientRoutes, /const \{ name, domain, status, contacts \} = request\.body/);
  assert.match(clientRoutes, /contacts:\s*contacts\?\.length\s*\?[\s\S]*create:/);
});

test('quick tasks accept canonical Kanban status and never write NOT_STARTED', () => {
  const result = taskCreateQuickSchema.safeParse({ title: 'Draft homepage', status: 'IN_PROGRESS' });
  assert.equal(result.success, true);
  assert.equal(result.data.status, 'IN_PROGRESS');
  assert.match(taskRoutes, /const \{ title, assigneeId, priority = 'NORMAL', status = 'PENDING' \}/);
  assert.match(taskRoutes, /status,\s*priority/);
  assert.doesNotMatch(taskRoutes, /status:\s*'NOT_STARTED'/);
});
