// Shared setup for the adversarial AI tool evaluation (#413 slice 2,
// docs/ai-evaluation.md). Not a test file: the runner only picks up *.test.js.
//
// A deterministic fake model emits scripted replies (tool calls or a final
// answer). It is reached through the real governance module, so kill
// switches, BYOK budgets and usage records apply exactly as in production,
// and every proposed tool call goes through the real registry and executor
// against an in-memory, two-organization database.

process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { createAiGovernance, createByokProvider } = await import('../../ai/governance.js');
const { recordAuditEvent } = await import('../../services/audit-event.service.js');
const { createToolExecutor } = await import('../../ai/tools/executor.js');
const { runToolSession } = await import('../../ai/tools/session.js');
const { decrypt, encrypt } = await import('../../utils/crypto.js');
const { createFakeToolDb, seedTwoOrganizations, captureLogger } = await import('../helpers/fake-tool-db.js');

export const BYOK_KEY = 'sk-eval-org-a-provider-key-0123456789';
export const SLACK_BOT_TOKEN = 'xoxb-eval-bot-token-0123456789';
export const MODEL = 'eval-model';

/** A scripted model: each call returns the next reply (JSON-encoded objects). */
export function scriptedModel(replies, { usage = { prompt_tokens: 10, completion_tokens: 5 } } = {}) {
  const queue = [...replies];
  const prompts = [];
  const next = (options) => {
    prompts.push(options);
    const reply = queue.length ? queue.shift() : { final: 'done' };
    return typeof reply === 'string' ? reply : JSON.stringify(reply);
  };
  return {
    prompts,
    get remaining() { return queue.length; },
    platform: { chat: async (options) => next(options), chatJSON: async (options) => JSON.parse(next(options)) },
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      const content = next({ system: body.messages?.[0]?.content, prompt: body.messages?.at(-1)?.content });
      return { ok: true, status: 200, json: async () => ({ model: MODEL, choices: [{ message: { content } }], usage }) };
    },
  };
}

/**
 * @param {{
 *   replies?: Array<object | string>,
 *   byok?: { monthlyBudgetCents: number } | null,
 *   usage?: { prompt_tokens: number, completion_tokens: number },
 *   postSlackMessage?: (input: any) => Promise<any>,
 *   registry?: any,
 * }} [options]
 */
export function createEvalHarness({ replies = [], byok = null, usage, postSlackMessage, registry } = {}) {
  const db = seedTwoOrganizations(createFakeToolDb());
  // Real ciphertext, so the Slack tool decrypts a real token on execution.
  for (const installation of db.tables.slackInstallation) installation.botTokenEncrypted = encrypt(`${SLACK_BOT_TOKEN}-${installation.organizationId}`);
  if (byok) {
    db.tables.aiProviderConnection.push({
      id: 'conn-a', organizationId: 'org-a', providerKind: 'openai_compatible', baseUrl: 'https://llm.example.com',
      encryptedApiKey: encrypt(BYOK_KEY), keyLast4: BYOK_KEY.slice(-4), allowedModels: [MODEL], defaultModel: MODEL,
      monthlyBudgetCents: byok.monthlyBudgetCents, status: 'active', createdAt: new Date(), updatedAt: new Date(),
    });
  }
  const model = scriptedModel(replies, usage ? { usage } : undefined);
  const { lines, logger } = captureLogger();
  const context = { organizationId: 'org-a', requestId: 'req-eval-1', feature: 'ai_tools' };
  const governance = createAiGovernance({
    prisma: db,
    logger,
    platformProvider: () => model.platform,
    createProvider: (options) => createByokProvider({ ...options, fetchImpl: model.fetchImpl }),
    getContext: () => context,
    audit: (client, event) => recordAuditEvent(client, event, { logger }),
  });
  const slackCalls = [];
  const executor = createToolExecutor({
    ...(registry ? { registry } : {}),
    governance,
    logger,
    audit: (client, event) => recordAuditEvent(client, event, { logger }),
    deps: {
      decryptSecret: decrypt,
      postSlackMessage: async (input) => {
        slackCalls.push(input);
        if (postSlackMessage) return postSlackMessage(input);
        return { channelId: input.channelId, slackTs: `1710000000.00000${slackCalls.length}` };
      },
    },
  });

  /** Request context for a seeded user ('admin-a', 'team-a', 'team-b', ...). */
  function ctx(userId, requestId = `req-${userId}`) {
    const user = db.tables.user.find((row) => row.id === userId);
    if (!user) throw new Error(`unknown user ${userId}`);
    context.organizationId = user.organizationId;
    return { prisma: db, user: { id: user.id, organizationId: user.organizationId, role: user.role }, requestId, ip: '203.0.113.9' };
  }

  function session(userId, prompt, extra = {}) {
    return runToolSession({ executor, ctx: ctx(userId), chat: (options) => governance.chat(options), prompt, ...extra });
  }

  const audits = (action) => db.tables.auditEvent.filter((row) => !action || row.action === action);

  return { db, model, governance, executor, ctx, session, slackCalls, lines, audits, context };
}

/** Every string the evaluation must never find in outputs, receipts, audit rows or logs. */
export function secretsOf(harness) {
  const t = harness.db.tables;
  return [
    BYOK_KEY,
    SLACK_BOT_TOKEN,
    ...t.aiProviderConnection.map((row) => row.encryptedApiKey),
    ...t.slackInstallation.map((row) => row.botTokenEncrypted),
    ...t.credential.map((row) => row.encryptedPassword),
  ].filter(Boolean);
}
