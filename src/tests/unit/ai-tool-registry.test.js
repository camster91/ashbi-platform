// Governed AI tool registry rules (#413 slice 2, docs/ai-tool-registry.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import {
  AI_BRIDGE_ACTION_TOOLS, BUILTIN_TOOLS, EXTERNAL_TOOL_ALLOWLIST, ToolRegistrationError,
  createToolRegistry, defineTool, toolRegistry,
} from '../../ai/tools/registry.js';

const base = {
  name: 'send_invoice_email',
  description: 'Send an invoice by email.',
  class: 'execute',
  roles: ['ADMIN'],
  inputSchema: z.object({ invoiceId: z.string() }).strict(),
  resolveScope: async () => ({ ids: {} }),
  rollback: 'Emails cannot be recalled.',
  preview: async () => ({}),
  execution: { mode: 'transaction', execute: async () => ({}) },
};

test('the external allowlist holds only the existing, confirm-gated Slack post', () => {
  assert.deepEqual([...EXTERNAL_TOOL_ALLOWLIST], ['send_slack_message']);
  const slack = toolRegistry.get('send_slack_message');
  assert.equal(slack.external, true);
  assert.equal(slack.irreversible, true);
  const external = toolRegistry.list().filter((tool) => tool.external || tool.irreversible).map((tool) => tool.name);
  assert.deepEqual(external, ['send_slack_message']);
});

test('external or irreversible tools are rejected unless allowlisted (default deny)', () => {
  assert.throws(() => defineTool({ ...base, irreversible: true }), ToolRegistrationError);
  assert.throws(() => defineTool({ ...base, name: 'delete_client', external: true }), ToolRegistrationError);
  assert.throws(() => defineTool({ ...base, class: 'read', run: async () => ({}), external: true }), ToolRegistrationError);
  assert.ok(defineTool({ ...base, irreversible: true }, { allowlist: ['send_invoice_email'] }));
});

test('execute tools always require confirmation and an idempotency key, and are never retried', () => {
  assert.throws(() => defineTool({ ...base, requiresConfirmation: false }), /always require confirmation/);
  assert.throws(() => defineTool({ ...base, idempotency: 'none' }), /idempotency key/);
  assert.throws(() => defineTool({ ...base, retry: { maxAttempts: 2 } }), /never retried/);
  assert.throws(() => defineTool({ ...base, rollback: '' }), /rollback/);
  const tool = defineTool(base);
  assert.equal(tool.requiresConfirmation, true);
  assert.equal(tool.idempotency, 'required');
  assert.equal(tool.retry.maxAttempts, 1);
  assert.equal(Object.isFrozen(tool), true);
});

test('registration rejects unknown classes, roles, missing schemas and duplicates', () => {
  assert.throws(() => defineTool({ ...base, class: 'admin' }), /class/);
  assert.throws(() => defineTool({ ...base, roles: ['CLIENT'] }), /roles/);
  assert.throws(() => defineTool({ ...base, roles: [] }), /roles/);
  assert.throws(() => defineTool({ ...base, inputSchema: {} }), /Zod/);
  assert.throws(() => defineTool({ ...base, resolveScope: undefined }), /resolveScope/);
  assert.throws(() => defineTool({ ...base, timeoutMs: 120_000 }), /timeoutMs/);
  assert.throws(() => defineTool({ ...base, name: 'Bad Name' }), /snake case/);
  assert.throws(() => createToolRegistry([base, base]), /registered twice/);
});

test('the built-in catalogue registers the bridge actions as execute tools and read tools with roles', () => {
  for (const name of AI_BRIDGE_ACTION_TOOLS) {
    const tool = toolRegistry.get(name);
    assert.equal(tool.class, 'execute');
    assert.equal(tool.requiresConfirmation, true);
    assert.equal(tool.retry.maxAttempts, 1);
  }
  assert.deepEqual(toolRegistry.list().filter((tool) => tool.class === 'read').map((tool) => tool.name).sort(), [
    'get_ai_usage_summary', 'get_project_summary', 'list_my_tasks', 'list_projects',
  ]);
  assert.deepEqual([...toolRegistry.get('get_ai_usage_summary').roles], ['ADMIN']);
  assert.equal(toolRegistry.get('nope'), null);
  assert.equal(toolRegistry.get(undefined), null);
  assert.equal(BUILTIN_TOOLS.length, toolRegistry.list().length);
});

test('bridge tool schemas normalize input exactly as the bridge always hashed it', () => {
  const task = toolRegistry.get('create_task').inputSchema.parse({ projectId: 'p1', title: '  Hi  ' });
  assert.deepEqual(Object.keys(task), ['projectId', 'title', 'description', 'priority', 'dueDate']);
  assert.equal(task.title, 'Hi');
  assert.equal(task.priority, 'NORMAL');
  const event = toolRegistry.get('create_calendar_event').inputSchema.safeParse({
    projectId: 'p1', title: 'x', startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T09:00:00Z',
  });
  assert.equal(event.success, false);
  const slack = toolRegistry.get('send_slack_message').inputSchema.parse({ projectId: 'p1', text: ' hi ' });
  assert.deepEqual(slack, { projectId: 'p1', text: 'hi' });
});

test('previews show the approver every persisted, user-visible field', async () => {
  const scope = { records: { project: { id: 'p1', name: 'Website' } } };
  const task = toolRegistry.get('create_task');
  const taskInput = task.inputSchema.parse({ projectId: 'p1', title: 'Title', description: 'Full description text', dueDate: '2026-01-02' });
  const event = toolRegistry.get('create_calendar_event');
  const eventInput = event.inputSchema.parse({
    projectId: 'p1', title: 'Kickoff', description: 'Agenda', location: ' Room 4 ',
    startTime: '2026-01-01T10:00:00Z', endTime: '2026-01-01T11:00:00Z',
  });
  const eventPreview = await event.preview({ input: eventInput, scope });
  assert.equal(eventPreview.location, 'Room 4');
  // Every persisted field of each execute tool's input appears in its preview.
  for (const [tool, input] of [[task, taskInput], [event, eventInput]]) {
    const preview = await tool.preview({ input, scope });
    for (const [field, value] of Object.entries(input)) {
      if (field === 'projectId' || value === undefined) continue;
      assert.equal(preview[field], value, `${tool.name}.${field} is missing from the preview`);
    }
  }
});
