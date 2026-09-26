// Adversarial evaluation: an ambiguous failure is not retried
// (docs/ai-evaluation.md). A timeout or network error after an external
// delivery was attempted ends with outcome `unknown`; the action is never
// sent again, by the executor or by another approval.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createEvalHarness } from './harness.js';
import { toolRegistry } from '../../ai/tools/registry.js';

async function prepareSlack(harness, key) {
  const ctx = harness.ctx('team-a');
  const { action } = await harness.executor.invoke(ctx, {
    tool: 'send_slack_message', input: { projectId: 'project-a', text: 'Release is live' }, idempotencyKey: key,
  });
  return { ctx, action };
}

test('a network error after delivery was attempted is recorded as unknown and never retried', async () => {
  const harness = createEvalHarness({ postSlackMessage: async () => { throw new Error('ECONNRESET'); } });
  const { ctx, action } = await prepareSlack(harness, 'ambiguous-0001');

  await assert.rejects(harness.executor.approve(ctx, action.id), { code: 'EXECUTION_FAILED', statusCode: 502 });
  const receipt = harness.db.tables.aiBridgeAction[0];
  assert.equal(receipt.status, 'FAILED');
  assert.equal(receipt.outcome, 'unknown');
  assert.equal(receipt.errorCode, 'ACTION_EXECUTION_FAILED');
  assert.deepEqual(receipt.result, { deliveryState: 'UNKNOWN', mappingId: 'mapping-a', channelId: 'CA1' });
  assert.equal(receipt.approverId, 'team-a');
  assert.equal(receipt.approvalEvidence.method, 'session_step_up');
  assert.equal(harness.slackCalls.length, 1);

  // Approving again, by the requester or an admin, does not resend.
  await assert.rejects(harness.executor.approve(ctx, action.id), { code: 'ACTION_UNAVAILABLE' });
  await assert.rejects(harness.executor.approve(harness.ctx('admin-a'), action.id), { code: 'ACTION_UNAVAILABLE' });
  // Re-proposing with the same key returns the failed receipt.
  const replay = await harness.executor.invoke(ctx, { tool: 'send_slack_message', input: { projectId: 'project-a', text: 'Release is live' }, idempotencyKey: 'ambiguous-0001' });
  assert.equal(replay.action.status, 'FAILED');
  assert.equal(harness.slackCalls.length, 1, 'exactly one delivery attempt');
  assert.equal(harness.audits('ai.tool_failed')[0].metadata.outcome, 'unknown');
});

test('a delivery that times out is recorded as unknown', async () => {
  const harness = createEvalHarness({ postSlackMessage: () => new Promise(() => {}) });
  const slack = toolRegistry.get('send_slack_message');
  assert.equal(slack.retry.maxAttempts, 1);
  const { ctx, action } = await prepareSlack(harness, 'ambiguous-0002');
  const originalTimeout = slack.timeoutMs;
  // Shorten the wait for the test without changing the frozen tool.
  const { createToolExecutor } = await import('../../ai/tools/executor.js');
  const { createToolRegistry, BUILTIN_TOOLS } = await import('../../ai/tools/registry.js');
  const fast = createToolRegistry(BUILTIN_TOOLS.map((tool) => (tool.name === 'send_slack_message' ? { ...tool, timeoutMs: 20 } : tool)));
  const executor = createToolExecutor({
    registry: fast,
    governance: harness.governance,
    logger: { warn() {}, error() {} },
    deps: { decryptSecret: () => 'token', postSlackMessage: (input) => { harness.slackCalls.push(input); return new Promise(() => {}); } },
  });
  await assert.rejects(executor.approve(ctx, action.id), { code: 'EXECUTION_FAILED' });
  const receipt = harness.db.tables.aiBridgeAction[0];
  assert.equal(receipt.errorCode, 'ACTION_TIMEOUT');
  assert.equal(receipt.outcome, 'unknown');
  assert.equal(harness.slackCalls.length, 1);
  assert.equal(originalTimeout, 15_000);
});

test('a target that disappeared before delivery is a definite failure, not unknown', async () => {
  const harness = createEvalHarness();
  const { ctx, action } = await prepareSlack(harness, 'ambiguous-0003');
  harness.db.tables.slackChannelMapping.find((row) => row.id === 'mapping-a').outboundEnabled = false;
  await assert.rejects(harness.executor.approve(ctx, action.id), { code: 'EXECUTION_FAILED', statusCode: 409 });
  const receipt = harness.db.tables.aiBridgeAction[0];
  assert.equal(receipt.errorCode, 'ACTION_TARGET_UNAVAILABLE');
  assert.equal(receipt.outcome, 'failed');
  assert.equal(harness.slackCalls.length, 0);
});

test('a failed database action rolls back and is not retried', async () => {
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  const { action } = await harness.executor.invoke(ctx, { tool: 'create_task', input: { projectId: 'project-a', title: 'Will fail' }, idempotencyKey: 'ambiguous-0004' });
  let attempts = 0;
  harness.db.task.create = async () => { attempts += 1; throw new Error('deadlock detected'); };
  await assert.rejects(harness.executor.approve(harness.ctx('admin-a'), action.id), { code: 'EXECUTION_FAILED' });
  assert.equal(attempts, 1);
  const receipt = harness.db.tables.aiBridgeAction[0];
  assert.equal(receipt.status, 'FAILED');
  assert.equal(receipt.outcome, 'failed');
  // The rollback undid the claim, but the receipt still names the approver.
  assert.equal(receipt.approverId, 'admin-a');
  assert.equal(receipt.approvalEvidence.requesterApproved, false);
  assert.ok(receipt.confirmedAt instanceof Date);
  assert.deepEqual(harness.audits().map((row) => row.action).filter((name) => name !== 'ai.tool_prepared'), ['ai.tool_approved', 'ai.tool_failed']);
  await assert.rejects(harness.executor.approve(ctx, action.id), { code: 'ACTION_UNAVAILABLE' });
  assert.equal(attempts, 1);
});

test('a database action that exceeds its timeout is rolled back and recorded, not retried', async () => {
  const { createToolExecutor } = await import('../../ai/tools/executor.js');
  const { createToolRegistry, BUILTIN_TOOLS } = await import('../../ai/tools/registry.js');
  const harness = createEvalHarness();
  const ctx = harness.ctx('team-a');
  const fast = createToolRegistry(BUILTIN_TOOLS.map((tool) => (tool.name === 'create_task' ? { ...tool, timeoutMs: 20 } : tool)));
  const executor = createToolExecutor({ registry: fast, governance: harness.governance, logger: { warn() {}, error() {} } });
  const { action } = await executor.invoke(ctx, { tool: 'create_task', input: { projectId: 'project-a', title: 'Slow' }, idempotencyKey: 'slow-task-0001' });
  let attempts = 0;
  harness.db.task.create = () => { attempts += 1; return new Promise(() => {}); };
  await assert.rejects(executor.approve(ctx, action.id), { code: 'EXECUTION_FAILED' });
  const receipt = harness.db.tables.aiBridgeAction[0];
  assert.equal(receipt.errorCode, 'ACTION_TIMEOUT');
  assert.equal(receipt.outcome, 'failed');
  assert.equal(receipt.approverId, 'team-a');
  assert.equal(attempts, 1);
});
