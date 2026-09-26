// Adversarial evaluation: runaway cost (docs/ai-evaluation.md). Every model
// turn is a governed, metered BYOK call; once the month's budget is spent the
// next turn is refused before the provider is contacted and the session
// stops, with no further tool calls.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MODEL, createEvalHarness } from './harness.js';

let previousPrices;
before(() => {
  previousPrices = process.env.AI_MODEL_PRICES;
  // 1 cent per 1,000 tokens: each 1,000-token turn costs 1 cent.
  process.env.AI_MODEL_PRICES = JSON.stringify({ [MODEL]: { input: 1_000, output: 1_000 } });
});
after(() => {
  if (previousPrices === undefined) delete process.env.AI_MODEL_PRICES;
  else process.env.AI_MODEL_PRICES = previousPrices;
});

test('a session stops as soon as the budget is exceeded mid-session', async () => {
  const loop = Array.from({ length: 20 }, () => ({ tool_calls: [{ name: 'list_projects', arguments: {} }] }));
  const harness = createEvalHarness({
    byok: { monthlyBudgetCents: 3 },
    usage: { prompt_tokens: 900, completion_tokens: 100 },
    replies: loop,
  });

  const result = await harness.session('admin-a', 'keep listing projects', { maxTurns: 20 });

  assert.equal(result.stoppedReason, 'AI_BUDGET_EXCEEDED');
  assert.equal(harness.model.prompts.length, 3, 'three priced turns spent the 3-cent budget; the fourth never reached the provider');
  assert.equal(result.steps.length, 3, 'no tool ran after the budget stop');
  assert.equal(harness.db.tables.aiUsageRecord.length, 3);
  assert.equal(harness.audits('ai.budget_exceeded').length, 1);
  assert.ok(harness.model.remaining > 0);
});

test('a kill switch flipped mid-session stops the next turn', async () => {
  const harness = createEvalHarness({
    replies: Array.from({ length: 5 }, () => ({ tool_calls: [{ name: 'list_projects', arguments: {} }] })),
  });
  let turns = 0;
  const result = await harness.session('admin-a', 'go', {
    maxTurns: 5,
    chat: async (options) => {
      turns += 1;
      if (turns === 2) {
        harness.db.tables.organization.find((org) => org.id === 'org-a').aiDisabled = true;
        harness.governance.invalidate('org-a');
      }
      return harness.governance.chat(options);
    },
  });
  assert.equal(result.stoppedReason, 'AI_DISABLED');
  assert.equal(result.steps.length, 1);
  assert.equal(harness.model.prompts.length, 1);
});
