// Adversarial evaluation: racing approvals (docs/ai-evaluation.md). Every
// status transition is conditional on the status it expects; the loser of a
// race gets 409 ACTION_UNAVAILABLE, never a 500 or a false receipt. Real
// concurrent approvers against PostgreSQL are covered by
// src/tests/integration/ai-tool-receipts.database.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvalHarness } from './harness.js';
import { createToolExecutor } from '../../ai/tools/executor.js';

/** Let `mutate` change the row after the executor loaded it, before it claims it. */
function interleave(harness, mutate) {
  const original = harness.db.$transaction;
  harness.db.$transaction = async (work) => {
    harness.db.$transaction = original;
    mutate(harness.db.tables.aiBridgeAction[0]);
    return original(work);
  };
}

for (const [tool, input] of [
  ['create_task', { projectId: 'project-a', title: 'Raced' }],
  ['send_slack_message', { projectId: 'project-a', text: 'Raced' }],
]) {
  test(`${tool}: an approver who loses the claim gets 409 and nothing runs twice`, async () => {
    const harness = createEvalHarness();
    const ctx = harness.ctx('admin-a');
    const { action } = await harness.executor.invoke(harness.ctx('team-a'), { tool, input, idempotencyKey: `race-${tool}-0001` });
    // Another approver claimed it after this request loaded it.
    interleave(harness, (row) => { row.status = 'EXECUTING'; row.approverId = 'team-a'; });
    await assert.rejects(harness.executor.approve(ctx, action.id), (error) => {
      assert.equal(error.code, 'ACTION_UNAVAILABLE');
      assert.equal(error.statusCode, 409);
      assert.equal(error.action.status, 'EXECUTING');
      return true;
    });
    const row = harness.db.tables.aiBridgeAction[0];
    assert.equal(row.approverId, 'team-a', 'the winner\'s evidence is untouched');
    assert.equal(harness.db.tables.task.length, 2);
    assert.equal(harness.slackCalls.length, 0);
    assert.equal(harness.audits('ai.tool_approved').length, 0);
  });
}

test('an action that expires between the check and the claim is not executed', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  const { action } = await harness.executor.invoke(ctx, { tool: 'create_task', input: { projectId: 'project-a', title: 'Late' }, idempotencyKey: 'race-expiry-0001' });
  const expiresAt = harness.db.tables.aiBridgeAction[0].expiresAt.getTime();
  // First read of the clock is just before expiry, the claim's just after.
  const clock = [expiresAt - 1, expiresAt + 1];
  const executor = createToolExecutor({ governance: harness.governance, now: () => new Date(clock.length > 1 ? clock.shift() : clock[0]) });
  await assert.rejects(executor.approve(ctx, action.id), { code: 'ACTION_UNAVAILABLE' });
  assert.equal(harness.db.tables.task.length, 2);
  assert.equal(harness.db.tables.aiBridgeAction[0].status, 'PENDING_CONFIRMATION');
});

test('expiry never overwrites an action another approver already claimed', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('admin-a');
  const { action } = await harness.executor.invoke(harness.ctx('team-a'), { tool: 'create_task', input: { projectId: 'project-a', title: 'Claimed' }, idempotencyKey: 'race-expire-claimed-0001' });
  const stale = structuredClone(harness.db.tables.aiBridgeAction[0]);
  harness.db.tables.aiBridgeAction[0].status = 'EXECUTING';
  // This request still sees the stale pending copy, now past its expiry.
  const findFirst = harness.db.aiBridgeAction.findFirst;
  harness.db.aiBridgeAction.findFirst = async (args) => (args?.where?.id === action.id && !args.where.status ? { ...stale, expiresAt: new Date(0) } : findFirst(args));
  await assert.rejects(harness.executor.approve(ctx, action.id), { code: 'ACTION_UNAVAILABLE' });
  assert.equal(harness.db.tables.aiBridgeAction[0].status, 'EXECUTING');
  assert.equal(harness.audits('ai.tool_expired').length, 0);
});
