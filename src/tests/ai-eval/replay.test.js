// Adversarial evaluation: replay and retry (docs/ai-evaluation.md). Execution
// is idempotent by (tool, idempotency key, input hash).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvalHarness } from './harness.js';

const INPUT = { projectId: 'project-a', title: 'Draft homepage copy', priority: 'HIGH' };

test('the same key with different input is rejected', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  await harness.executor.invoke(ctx, { tool: 'create_task', input: INPUT, idempotencyKey: 'replay-key-0001' });
  await assert.rejects(
    harness.executor.invoke(ctx, { tool: 'create_task', input: { ...INPUT, title: 'Something else' }, idempotencyKey: 'replay-key-0001' }),
    { code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 },
  );
  await assert.rejects(
    harness.executor.invoke(ctx, { tool: 'create_calendar_event', input: {
      projectId: 'project-a', title: 'Draft homepage copy', startTime: '2026-10-01T10:00:00Z', endTime: '2026-10-01T11:00:00Z',
    }, idempotencyKey: 'replay-key-0001' }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  assert.equal(harness.db.tables.aiBridgeAction.length, 1);
  assert.deepEqual(harness.audits('ai.tool_denied').map((row) => row.metadata.reason), ['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT']);
});

test('the same key with the same input returns the stored action, then the stored receipt', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  const first = await harness.executor.invoke(ctx, { tool: 'create_task', input: INPUT, idempotencyKey: 'replay-key-0002' });
  // Whitespace the schema trims away is the same input.
  const again = await harness.executor.invoke(ctx, { tool: 'create_task', input: { ...INPUT, title: `  ${INPUT.title} ` }, idempotencyKey: 'replay-key-0002' });
  assert.equal(again.idempotent, true);
  assert.equal(again.action.id, first.action.id);

  const executed = await harness.executor.approve(ctx, first.action.id);
  assert.equal(executed.action.status, 'EXECUTED');
  const replayApprove = await harness.executor.approve(ctx, first.action.id);
  assert.equal(replayApprove.idempotent, true);
  assert.deepEqual(replayApprove.action.result, executed.action.result);
  const replayInvoke = await harness.executor.invoke(ctx, { tool: 'create_task', input: INPUT, idempotencyKey: 'replay-key-0002' });
  assert.equal(replayInvoke.idempotent, true);
  assert.equal(replayInvoke.action.status, 'EXECUTED');

  assert.equal(harness.db.tables.task.filter((task) => task.title === INPUT.title).length, 1, 'exactly one task');
  assert.equal(harness.audits('ai.tool_executed').length, 1);
});

test('a model repeating the same proposal in one session creates one pending action', async () => {
  const call = { name: 'create_task', arguments: INPUT };
  const harness = createEvalHarness({ replies: [{ tool_calls: [call, call] }, { tool_calls: [call] }, { final: 'ok' }] });
  const result = await harness.session('team-a', 'make the task');
  assert.deepEqual(result.steps.map((step) => step.idempotent), [false, true, true]);
  assert.equal(harness.db.tables.aiBridgeAction.length, 1);
});

test('a receipt cannot be rewritten once terminal', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  const { action } = await harness.executor.invoke(ctx, { tool: 'create_task', input: INPUT, idempotencyKey: 'replay-key-0003' });
  await harness.executor.approve(ctx, action.id);
  await assert.rejects(
    harness.db.aiBridgeAction.update({ where: { id: action.id }, data: { approverId: 'someone-else' } }),
    /immutable/,
  );
  await assert.rejects(harness.executor.reject(ctx, action.id), { code: 'ACTION_UNAVAILABLE' });
});
