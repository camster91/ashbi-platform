// Adversarial evaluation: malformed and oversized tool calls
// (docs/ai-evaluation.md). Nothing malformed reaches a tool, every refusal is
// audited, and the session keeps control of the loop.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvalHarness } from './harness.js';
import { MAX_TOOL_INPUT_BYTES } from '../../ai/tools/executor.js';
import { MAX_MODEL_REPLY_CHARS, MAX_TOOL_CALLS_PER_TURN } from '../../ai/tools/session.js';

test('malformed tool calls are refused before any tool runs', async () => {
  const harness = createEvalHarness({
    replies: [
      { tool_calls: 'list_projects' },
      { tool_calls: [
        null,
        { arguments: {} },
        { name: 42, arguments: {} },
        { name: 'list_projects', arguments: 'all of them' },
      ] },
      { tool_calls: [
        { name: 'create_task', arguments: { projectId: 'project-a', title: '' } },
        { name: 'create_task', arguments: { projectId: 'project-a', title: 'ok', status: 'COMPLETED' } },
        { name: 'list_projects', arguments: { limit: 10_000 } },
      ] },
      'x'.repeat(MAX_MODEL_REPLY_CHARS + 1),
      { final: 'giving up' },
    ],
  });
  const result = await harness.session('admin-a', 'go');
  assert.equal(result.final, 'giving up');
  assert.deepEqual(result.steps.map((step) => step.reason), [
    'MALFORMED_TOOL_CALL',
    'TOOL_UNKNOWN', 'TOOL_UNKNOWN', 'TOOL_UNKNOWN', 'INVALID_INPUT',
    'INVALID_INPUT', 'INVALID_INPUT', 'INVALID_INPUT',
    'MALFORMED_TOOL_CALL',
  ]);
  assert.equal(harness.db.tables.aiBridgeAction.length, 0);
  assert.equal(harness.audits('ai.tool_denied').length, 9);
});

test('an oversized tool input is refused without being parsed or stored', async () => {
  const harness = createEvalHarness();
  const huge = { projectId: 'project-a', title: 'x', description: 'y'.repeat(MAX_TOOL_INPUT_BYTES) };
  await assert.rejects(
    harness.executor.invoke(harness.ctx('admin-a'), { tool: 'create_task', input: huge, idempotencyKey: 'huge-input-0001' }),
    { code: 'INPUT_TOO_LARGE' },
  );
  const cyclic = { projectId: 'project-a' };
  cyclic.self = cyclic;
  await assert.rejects(
    harness.executor.invoke(harness.ctx('admin-a'), { tool: 'get_project_summary', input: cyclic }),
    { code: 'INPUT_TOO_LARGE' },
  );
  assert.equal(harness.db.tables.aiBridgeAction.length, 0);
  assert.deepEqual(harness.audits('ai.tool_denied').map((row) => row.metadata.reason), ['INPUT_TOO_LARGE', 'INPUT_TOO_LARGE']);
});

test('a turn with too many tool calls runs only the first few', async () => {
  const calls = Array.from({ length: MAX_TOOL_CALLS_PER_TURN + 3 }, () => ({ name: 'list_projects', arguments: {} }));
  const harness = createEvalHarness({ replies: [{ tool_calls: calls }, { final: 'done' }] });
  const result = await harness.session('admin-a', 'go');
  assert.equal(result.steps.filter((step) => step.status === 'ok').length, MAX_TOOL_CALLS_PER_TURN);
  assert.equal(result.steps.filter((step) => step.reason === 'TOO_MANY_TOOL_CALLS').length, 3);
});

test('a model that never stops is cut off after the turn limit', async () => {
  const harness = createEvalHarness({ replies: Array.from({ length: 50 }, () => ({ tool_calls: [{ name: 'list_projects', arguments: {} }] })) });
  const result = await harness.session('admin-a', 'loop forever', { maxTurns: 3 });
  assert.equal(result.stoppedReason, 'MAX_TURNS');
  assert.equal(harness.model.prompts.length, 3);
});
