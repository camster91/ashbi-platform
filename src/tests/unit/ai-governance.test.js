// AI control plane resolution, metering and budgets (#413, docs/ai-byok.md).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { createAiGovernance, createByokProvider, setPlatformAiDisabled, AI_ORG_CACHE_TTL_MS } = await import('../../ai/governance.js');
const { AiBudgetExceededError, AiDisabledError, AiProviderError } = await import('../../ai/errors.js');
const { recordAuditEvent } = await import('../../services/audit-event.service.js');
const { encrypt } = await import('../../utils/crypto.js');
const { toClientErrorBody } = await import('../../utils/http-errors.js');
const { createFakeAiDb } = await import('../helpers/fake-ai-db.js');

const KEY = 'sk-org-a-secret-9876543210';
const PRICES = JSON.stringify({ 'model-a': { input: 100_000, output: 100_000 } }); // 0.1 cent per token

function captureLogger() {
  const lines = [];
  const log = (level) => (obj, msg) => lines.push(JSON.stringify({ level, obj, msg }));
  return { lines, logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') } };
}

function fakeFetch(handler) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return handler(url, init);
    },
  };
}

const okCompletion = (promptTokens = 10, completionTokens = 5, content = 'byok answer') => ({
  ok: true,
  status: 200,
  json: async () => ({ model: 'model-a', choices: [{ message: { content } }], usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens } }),
});

function setup({ connection, org = {}, fetchHandler = () => okCompletion(), context = { organizationId: 'org-a', requestId: 'req-1', feature: '/api/ai/ask' } } = {}) {
  const db = createFakeAiDb({ organizations: [{ id: 'org-a', ...org }, { id: 'org-b' }] });
  if (connection) {
    db.aiProviderConnection.rows.push({
      id: 'conn-a',
      organizationId: 'org-a',
      providerKind: 'openai_compatible',
      baseUrl: 'https://llm.example.com',
      encryptedApiKey: encrypt(KEY),
      keyLast4: KEY.slice(-4),
      allowedModels: ['model-a', 'model-b'],
      defaultModel: 'model-a',
      monthlyBudgetCents: 1000,
      status: 'active',
      ...connection,
    });
  }
  const platformCalls = [];
  const platform = {
    name: 'platform',
    chat: async (options) => { platformCalls.push(['chat', options]); return 'platform answer'; },
    chatJSON: async (options) => { platformCalls.push(['chatJSON', options]); return { platform: true }; },
  };
  const { calls, fetchImpl } = fakeFetch(fetchHandler);
  const { lines, logger } = captureLogger();
  let clock = new Date('2026-09-15T12:00:00Z');
  const state = { context };
  const governance = createAiGovernance({
    prisma: db,
    logger,
    now: () => clock,
    platformProvider: () => platform,
    createProvider: (options) => createByokProvider({ ...options, isProduction: false, fetchImpl }),
    getContext: () => state.context,
    audit: (client, event) => recordAuditEvent(client, event, { logger }),
  });
  return {
    db, governance, platformCalls, calls, lines, state,
    advance(ms) { clock = new Date(clock.getTime() + ms); },
    setClock(date) { clock = date; },
  };
}

beforeEach(() => {
  process.env.AI_MODEL_PRICES = PRICES;
  delete process.env.AI_DISABLED;
  setPlatformAiDisabled(false);
});

afterEach(() => {
  delete process.env.AI_MODEL_PRICES;
  delete process.env.AI_DISABLED;
  setPlatformAiDisabled(false);
});

describe('resolution order', () => {
  it('platform kill switch (env) blocks every call before any lookup', async () => {
    process.env.AI_DISABLED = 'true';
    const t = setup({ connection: {} });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), (err) => err instanceof AiDisabledError && err.scope === 'platform' && err.code === 'AI_DISABLED');
    assert.equal(t.calls.length + t.platformCalls.length, 0);
  });

  it('platform kill switch (operator toggle) blocks calls without an organization too', async () => {
    setPlatformAiDisabled(true);
    const t = setup({ context: null });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiDisabledError);
    assert.equal(t.platformCalls.length, 0);
  });

  it('organization kill switch blocks both BYOK and platform calls', async () => {
    const withConnection = setup({ connection: {}, org: { aiDisabled: true } });
    await assert.rejects(withConnection.governance.chat({ prompt: 'x' }), (err) => err instanceof AiDisabledError && err.scope === 'organization');
    const withoutConnection = setup({ org: { aiDisabled: true } });
    await assert.rejects(withoutConnection.governance.chatJSON({ prompt: 'x' }), AiDisabledError);
    assert.equal(withConnection.calls.length + withoutConnection.platformCalls.length, 0);
  });

  it('an active BYOK connection is used, with its default model, and metered', async () => {
    const t = setup({ connection: {} });
    assert.equal(await t.governance.chat({ system: 'S', prompt: 'hello', temperature: 0.2 }), 'byok answer');
    assert.equal(t.platformCalls.length, 0);
    assert.equal(t.calls.length, 1);
    assert.equal(t.calls[0].url, 'https://llm.example.com/v1/chat/completions');
    assert.equal(JSON.parse(t.calls[0].init.body).model, 'model-a');
    assert.equal(t.db.aiUsageRecord.rows.length, 1);
    const [usage] = t.db.aiUsageRecord.rows;
    assert.deepEqual(
      { ...usage, id: undefined, createdAt: undefined, updatedAt: undefined },
      {
        id: undefined, createdAt: undefined, updatedAt: undefined,
        organizationId: 'org-a', connectionId: 'conn-a', model: 'model-a', promptTokens: 10, completionTokens: 5,
        estimatedCostCents: 1.5, feature: '/api/ai/ask', requestId: 'req-1', success: true, errorType: null,
      },
    );
  });

  it('an allowed requested model is honoured; others fall back to the default', async () => {
    const t = setup({ connection: {} });
    await t.governance.chat({ prompt: 'x', model: 'model-b' });
    await t.governance.chat({ prompt: 'x', model: 'not-allowed' });
    assert.deepEqual(t.calls.map((call) => JSON.parse(call.init.body).model), ['model-b', 'model-a']);
  });

  it('chatJSON through BYOK parses the reply', async () => {
    const t = setup({ connection: {}, fetchHandler: () => okCompletion(1, 1, '{"tags":["x"]}') });
    assert.deepEqual(await t.governance.chatJSON({ system: 'S', prompt: 'P' }), { tags: ['x'] });
  });

  it('without a connection the platform provider gets exactly the caller options', async () => {
    const t = setup();
    const options = { system: 'S', prompt: 'P', temperature: 0.3, maxTokens: 99 };
    assert.equal(await t.governance.chat(options), 'platform answer');
    assert.deepEqual(await t.governance.chatJSON(options), { platform: true });
    assert.deepEqual(t.platformCalls, [['chat', options], ['chatJSON', options]]);
    assert.equal(t.db.aiUsageRecord.rows.length, 0);
  });

  it('with no organization context (e.g. an unscoped job) the platform provider is used', async () => {
    const t = setup({ connection: {}, context: null });
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'platform answer');
    assert.equal(t.calls.length, 0);
  });

  it('a revoked connection falls back to the platform provider', async () => {
    const t = setup({ connection: { status: 'revoked', encryptedApiKey: null } });
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'platform answer');
  });

  it('a disabled connection fails closed instead of falling back', async () => {
    const t = setup({ connection: { status: 'disabled', disabledReason: 'validation_failed:auth' } });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), (err) => err.code === 'AI_CONNECTION_DISABLED' && err.statusCode === 503);
    assert.equal(t.platformCalls.length + t.calls.length, 0);
  });

  it('another organization\'s connection is never used', async () => {
    const t = setup({ connection: {}, context: { organizationId: 'org-b' } });
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'platform answer');
    assert.equal(t.calls.length, 0);
  });

  it('caches per organization and picks up changes after invalidate or the TTL', async () => {
    const t = setup();
    await t.governance.chat({ prompt: 'x' });
    t.db.organization.rows[0].aiDisabled = true;
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'platform answer', 'cached state until TTL/invalidate');
    t.governance.invalidate('org-a');
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiDisabledError);
    t.db.organization.rows[0].aiDisabled = false;
    t.advance(AI_ORG_CACHE_TTL_MS + 1);
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'platform answer');
  });
});

describe('failures', () => {
  it('a provider error is recorded, surfaced as a typed error and neither retried nor sent to the platform', async () => {
    const t = setup({ connection: {}, fetchHandler: () => ({ ok: false, status: 401, json: async () => ({ error: { message: `bad key ${KEY}` } }) }) });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), (err) => err instanceof AiProviderError && err.type === 'auth');
    assert.equal(t.calls.length, 1);
    assert.equal(t.platformCalls.length, 0);
    assert.equal(t.db.aiUsageRecord.rows[0].success, false);
    assert.equal(t.db.aiUsageRecord.rows[0].errorType, 'auth');
  });

  it('an undecryptable key fails closed with AI_CONNECTION_UNAVAILABLE', async () => {
    const t = setup({ connection: { encryptedApiKey: 'v1:missing-version:00:00:00' } });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), (err) => err.code === 'AI_CONNECTION_UNAVAILABLE');
    assert.equal(t.platformCalls.length, 0);
  });

  it('AI errors become clear client bodies rather than generic 500s', () => {
    const disabled = toClientErrorBody(new AiDisabledError('organization'), { traceId: 'r1' });
    assert.equal(disabled.code, 'AI_DISABLED');
    assert.equal(disabled.statusCode, 503);
    assert.match(disabled.error, /turned off/);
    const budget = toClientErrorBody(new AiBudgetExceededError());
    assert.equal(budget.code, 'AI_BUDGET_EXCEEDED');
    assert.equal(budget.statusCode, 402);
  });
});

describe('budgets', () => {
  it('blocks the call once month-to-date spend reaches the budget, without contacting the provider', async () => {
    const t = setup({ connection: { monthlyBudgetCents: 10 } });
    t.db.aiUsageRecord.rows.push({ organizationId: 'org-a', connectionId: 'conn-a', estimatedCostCents: 10, promptTokens: 0, completionTokens: 0, createdAt: new Date('2026-09-02T00:00:00Z'), success: true });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), (err) => err instanceof AiBudgetExceededError && err.code === 'AI_BUDGET_EXCEEDED');
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiBudgetExceededError);
    assert.equal(t.calls.length, 0);
    const events = t.db.auditEvent.rows.filter((event) => event.action === 'ai.budget_exceeded');
    assert.equal(events.length, 1, 'throttled to one event per window');
    assert.deepEqual(events[0].metadata, { month: '2026-09', spentCents: 10, budgetCents: 10 });
    assert.equal(events[0].actorType, 'SYSTEM');
    assert.equal(events[0].organizationId, 'org-a');

    t.advance(60 * 60 * 1000);
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiBudgetExceededError);
    assert.equal(t.db.auditEvent.rows.filter((event) => event.action === 'ai.budget_exceeded').length, 2);
  });

  it('spend from last month does not count', async () => {
    const t = setup({ connection: { monthlyBudgetCents: 10 } });
    t.db.aiUsageRecord.rows.push({ organizationId: 'org-a', connectionId: 'conn-a', estimatedCostCents: 500, promptTokens: 0, completionTokens: 0, createdAt: new Date('2026-08-31T23:59:59Z'), success: true });
    assert.equal(await t.governance.chat({ prompt: 'x' }), 'byok answer');
  });

  it('emits one ai.budget_alert per month when spend crosses 80%', async () => {
    const t = setup({ connection: { monthlyBudgetCents: 10 } }); // each call costs 1.5 cents
    for (let i = 0; i < 5; i += 1) await t.governance.chat({ prompt: 'x' }); // 7.5 cents
    assert.equal(t.db.auditEvent.rows.filter((event) => event.action === 'ai.budget_alert').length, 0);
    await t.governance.chat({ prompt: 'x' }); // 9 cents >= 8
    await t.governance.chat({ prompt: 'x' }); // 10.5 cents
    const alerts = t.db.auditEvent.rows.filter((event) => event.action === 'ai.budget_alert');
    assert.equal(alerts.length, 1);
    assert.deepEqual(alerts[0].metadata, { month: '2026-09', spentCents: 9, budgetCents: 10, thresholdPercent: 80 });
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiBudgetExceededError);

    // A second process (fresh throttle) does not repeat this month's alert.
    t.governance._resetThrottles();
    t.db.aiProviderConnection.rows[0].monthlyBudgetCents = 11;
    t.governance.invalidate('org-a');
    await t.governance.chat({ prompt: 'x' });
    assert.equal(t.db.auditEvent.rows.filter((event) => event.action === 'ai.budget_alert').length, 1);
  });

  it('unpriced models are metered with a null cost', async () => {
    process.env.AI_MODEL_PRICES = '{}';
    const t = setup({ connection: {} });
    await t.governance.chat({ prompt: 'x' });
    assert.equal(t.db.aiUsageRecord.rows[0].estimatedCostCents, null);
    const usage = await t.governance.monthToDateUsage('org-a');
    assert.equal(usage.unpricedTokens, 15);
    assert.equal(usage.spentCents, 0);
  });
});

describe('secrecy', () => {
  it('the key never appears in logs, usage records or audit metadata', async () => {
    const t = setup({ connection: { monthlyBudgetCents: 3 } });
    await t.governance.chat({ prompt: 'x' });
    await t.governance.chat({ prompt: 'x' }); // crosses 80% -> alert
    await assert.rejects(t.governance.chat({ prompt: 'x' }), AiBudgetExceededError);
    t.db.aiUsageRecord.create = async () => { throw Object.assign(new Error(`db down ${KEY}`), { code: 'P1001' }); };
    t.db.aiProviderConnection.rows[0].monthlyBudgetCents = 100_000;
    t.governance.invalidate('org-a');
    await t.governance.chat({ prompt: 'x' });

    const everything = JSON.stringify({ logs: t.lines, usage: t.db.aiUsageRecord.rows, audit: t.db.auditEvent.rows });
    assert.ok(t.lines.some((line) => line.includes('AI usage record write failed')), 'the metering failure is logged');
    assert.doesNotMatch(everything, new RegExp(KEY));
    assert.doesNotMatch(everything, /9876543210/);
  });
});
