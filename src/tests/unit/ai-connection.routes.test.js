// Organization BYOK AI connection admin API (#413, docs/ai-byok.md).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Writable } from 'node:stream';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { default: aiConnectionRoutes } = await import('../../routes/ai-connection.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { decrypt } = await import('../../utils/crypto.js');
const { AiProviderError } = await import('../../ai/errors.js');
const { LOG_REDACT_OPTIONS } = await import('../../utils/log-redaction.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const PRICES = JSON.stringify({ 'model-a': { input: 100, output: 100 }, 'model-b': { input: 200, output: 200 }, 'model-z': { input: 1, output: 1 } });

const GOOD_KEY = 'sk-good-first-key-AAAA1111';
const GOOD_KEY_2 = 'sk-good-second-key-BBBB2222';
const BAD_KEY = 'sk-bad-rejected-key-CCCC3333';
const ALL_KEYS = [GOOD_KEY, GOOD_KEY_2, BAD_KEY];

const USERS = {
  adminA: { id: 'user-admin-a', role: 'ADMIN', organizationId: 'org-a' },
  adminB: { id: 'user-admin-b', role: 'ADMIN', organizationId: 'org-b' },
  teamA: { id: 'user-team-a', role: 'TEAM', organizationId: 'org-a' },
};

const CONNECT_BODY = {
  baseUrl: 'https://llm.example.com/v1',
  apiKey: GOOD_KEY,
  allowedModels: ['model-a', 'model-b'],
  defaultModel: 'model-a',
  monthlyBudgetCents: 5000,
};

let db;
let logs;
let providerCalls;

function fakeProviderFactory() {
  return ({ baseUrl, apiKey, model }) => {
    const check = (op) => {
      // Record what the row looked like at validation time (rotation order).
      providerCalls.push({ op, baseUrl, model, keyLast4: apiKey.slice(-4), storedCiphertext: db.aiProviderConnection.rows[0]?.encryptedApiKey ?? null });
      if (!apiKey.startsWith('sk-good')) throw new AiProviderError('auth', { upstreamStatus: 401 });
    };
    return {
      listModels: async () => { check('listModels'); return ['model-a', 'model-b', 'model-c']; },
      complete: async () => { check('complete'); return { content: 'ok', model, usage: { promptTokens: 1, completionTokens: 1 } }; },
    };
  };
}

async function buildApp(t, routeOptions = {}) {
  const stream = new Writable({ write(chunk, _enc, cb) { logs.push(chunk.toString()); cb(); } });
  const app = Fastify({ logger: { level: 'trace', stream, redact: LOG_REDACT_OPTIONS } });
  await app.register(cookie);
  const signIn = async (request, reply) => {
    const user = USERS[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = withSession(user);
    request.prisma = createScopedPrisma(db, user.organizationId);
    return undefined;
  };
  app.decorate('authenticate', signIn);
  app.decorate('adminOnly', async (request, reply) => {
    const denied = await signIn(request, reply);
    if (denied) return denied;
    if (request.user.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin access required' });
    return undefined;
  });
  await app.register(aiConnectionRoutes, { createProvider: fakeProviderFactory(), allowLocalhost: true, lookup: async () => [{ address: '93.184.216.34', family: 4 }], ...routeOptions });
  t.after(() => app.close());
  return app;
}

function send(app, userKey, method, url, payload, { reauth = true } = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: userKey ? { 'x-test-user': userKey } : {},
    cookies: userKey && reauth ? reauthCookies(USERS[userKey]) : {},
  });
}

const connect = (app, user = 'adminA', body = CONNECT_BODY) => send(app, user, 'POST', '/connect', body);

function assertNoKeyAnywhere(...extra) {
  const haystack = JSON.stringify({ logs, audit: db.auditEvent.rows, usage: db.aiUsageRecord.rows, extra });
  for (const key of ALL_KEYS) {
    assert.equal(haystack.includes(key), false, 'a raw key leaked into responses, logs or audit metadata');
  }
}

let restoreGovernance;

beforeEach(async () => {
  db = createFakeAiDb();
  logs = [];
  providerCalls = [];
  process.env.AI_MODEL_PRICES = PRICES;
  restoreGovernance = await installFakeGovernance(db);
});

afterEach(() => {
  restoreGovernance();
  delete process.env.AI_MODEL_PRICES;
});

describe('access control', () => {
  it('requires an ADMIN session for every route', async (t) => {
    const app = await buildApp(t);
    const routes = [
      ['GET', '/'], ['POST', '/connect', CONNECT_BODY], ['POST', '/validate'], ['POST', '/rotate', { apiKey: GOOD_KEY_2 }],
      ['POST', '/revoke'], ['PATCH', '/settings', { monthlyBudgetCents: 1 }], ['POST', '/disable'], ['POST', '/enable'],
    ];
    for (const [method, url, body] of routes) {
      assert.equal((await send(app, 'teamA', method, url, body)).statusCode, 403, `${method} ${url} as TEAM`);
      assert.equal((await send(app, null, method, url, body)).statusCode, 401, `${method} ${url} signed out`);
    }
    assert.equal(db.aiProviderConnection.rows.length, 0);
    assert.equal(db.organization.rows.every((org) => org.aiDisabled === false), true);
  });

  it('connect, rotate, revoke and the kill switch require step-up re-authentication', async (t) => {
    const app = await buildApp(t);
    for (const [url, body] of [['/connect', CONNECT_BODY], ['/rotate', { apiKey: GOOD_KEY_2 }], ['/revoke'], ['/disable'], ['/enable']]) {
      const response = await send(app, 'adminA', 'POST', url, body, { reauth: false });
      assert.equal(response.statusCode, 403, url);
      assert.equal(response.json().code, 'REAUTH_REQUIRED', url);
    }
    assert.equal(db.aiProviderConnection.rows.length, 0);
    assert.equal(providerCalls.length, 0, 'no provider call before step-up');
  });

  it('validate and settings do not need step-up', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    assert.equal((await send(app, 'adminA', 'POST', '/validate', undefined, { reauth: false })).statusCode, 200);
    assert.equal((await send(app, 'adminA', 'PATCH', '/settings', { monthlyBudgetCents: 10 }, { reauth: false })).statusCode, 200);
  });
});

describe('connect', () => {
  it('validates, encrypts and stores the key, returns it masked and audits host + last4 only', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app);
    assert.equal(response.statusCode, 201, response.body);
    const { connection } = response.json();
    assert.equal(connection.keyLast4, '1111');
    assert.equal(connection.hasKey, true);
    assert.equal(connection.baseUrl, 'https://llm.example.com');
    assert.equal(connection.status, 'active');
    assert.equal('encryptedApiKey' in connection, false);

    const [row] = db.aiProviderConnection.rows;
    assert.equal(row.organizationId, 'org-a');
    assert.notEqual(row.encryptedApiKey, GOOD_KEY);
    assert.match(row.encryptedApiKey, /^v1:/);
    assert.equal(decrypt(row.encryptedApiKey), GOOD_KEY);
    assert.equal(row.createdById, 'user-admin-a');
    assert.deepEqual(providerCalls.map((call) => call.op), ['listModels']);

    const [event] = db.auditEvent.rows;
    assert.equal(event.action, 'ai.connection_connected');
    assert.equal(event.organizationId, 'org-a');
    assert.deepEqual(event.metadata, {
      keyLast4: '1111', baseUrlHost: 'llm.example.com', defaultModel: 'model-a', allowedModelCount: 2, monthlyBudgetCents: 5000, replacedStatus: null,
    });

    const view = await send(app, 'adminA', 'GET', '/');
    assert.equal(view.json().connection.keyLast4, '1111');
    assertNoKeyAnywhere(response.body, view.body);
  });

  it('stores nothing when the provider rejects the key', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app, 'adminA', { ...CONNECT_BODY, apiKey: BAD_KEY });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().code, 'AI_CONNECTION_VALIDATION_FAILED');
    assert.equal(response.json().errorType, 'auth');
    assert.equal(db.aiProviderConnection.rows.length, 0);
    assert.equal(db.auditEvent.rows.length, 0);
    assertNoKeyAnywhere(response.body);
  });

  it('rejects a default model the provider does not offer', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app, 'adminA', { ...CONNECT_BODY, allowedModels: ['model-z'], defaultModel: 'model-z' });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().errorType, 'invalid_request');
    assert.equal(db.aiProviderConnection.rows.length, 0);
  });

  it('rejects a default model outside allowedModels before contacting the provider', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app, 'adminA', { ...CONNECT_BODY, defaultModel: 'model-c' });
    assert.equal(response.statusCode, 400);
    assert.equal(providerCalls.length, 0);
    assertNoKeyAnywhere(response.body);
  });

  it('rejects unsafe base URLs (SSRF) without contacting them', async (t) => {
    const dev = await buildApp(t);
    const plainHttp = await connect(dev, 'adminA', { ...CONNECT_BODY, baseUrl: 'http://llm.example.com' });
    assert.equal(plainHttp.statusCode, 400);
    assert.equal(plainHttp.json().code, 'UNSAFE_OUTBOUND_URL');

    const prod = await buildApp(t, { allowLocalhost: false, lookup: async () => [{ address: '169.254.169.254', family: 4 }] });
    const metadata = await connect(prod, 'adminA', { ...CONNECT_BODY, baseUrl: 'https://metadata.example.com' });
    assert.equal(metadata.statusCode, 400);
    assert.equal(providerCalls.length, 0);
    assert.equal(db.aiProviderConnection.rows.length, 0);
  });

  it('allows http://localhost outside production', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app, 'adminA', { ...CONNECT_BODY, baseUrl: 'http://localhost:11434/v1' });
    assert.equal(response.statusCode, 201, response.body);
  });
});

describe('model prices (budgets must count)', () => {
  it('connect rejects allowed or default models without a configured price', async (t) => {
    const app = await buildApp(t);
    process.env.AI_MODEL_PRICES = JSON.stringify({ 'model-a': { input: 1, output: 1 } });
    const response = await connect(app);
    assert.equal(response.statusCode, 400, response.body);
    assert.equal(response.json().code, 'MODEL_PRICE_UNKNOWN');
    assert.deepEqual(response.json().models, ['model-b']);
    assert.equal(providerCalls.length, 0, 'rejected before contacting the provider');
    assert.equal(db.aiProviderConnection.rows.length, 0);
  });

  it('settings reject switching to an unpriced model', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const response = await send(app, 'adminA', 'PATCH', '/settings', { allowedModels: ['model-a', 'model-new'] });
    assert.equal(response.statusCode, 400);
    assert.equal(response.json().code, 'MODEL_PRICE_UNKNOWN');
    assert.deepEqual(response.json().models, ['model-new']);
    assert.deepEqual(db.aiProviderConnection.rows[0].allowedModels, ['model-a', 'model-b']);
  });

  it('the view lists the priced models for the form', async (t) => {
    const app = await buildApp(t);
    assert.deepEqual((await send(app, 'adminA', 'GET', '/')).json().pricedModels, ['model-a', 'model-b', 'model-z']);
  });
});

describe('rotate, validate, revoke', () => {
  it('validate answers 503 AI_CONNECTION_UNAVAILABLE when the stored key cannot be decrypted', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    db.aiProviderConnection.rows[0].encryptedApiKey = 'v1:retired-version:00:00:00';
    const response = await send(app, 'adminA', 'POST', '/validate');
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().code, 'AI_CONNECTION_UNAVAILABLE');
  });

  it('rotation validates the new key before replacing the stored one', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const original = db.aiProviderConnection.rows[0].encryptedApiKey;

    const rejected = await send(app, 'adminA', 'POST', '/rotate', { apiKey: BAD_KEY });
    assert.equal(rejected.statusCode, 422);
    assert.equal(db.aiProviderConnection.rows[0].encryptedApiKey, original, 'old key untouched after a failed rotation');
    assert.equal(decrypt(db.aiProviderConnection.rows[0].encryptedApiKey), GOOD_KEY);

    providerCalls = [];
    const rotated = await send(app, 'adminA', 'POST', '/rotate', { apiKey: GOOD_KEY_2 });
    assert.equal(rotated.statusCode, 200, rotated.body);
    assert.equal(providerCalls[0].storedCiphertext, original, 'validated while the old key was still stored');
    assert.equal(providerCalls[0].keyLast4, '2222');
    assert.equal(decrypt(db.aiProviderConnection.rows[0].encryptedApiKey), GOOD_KEY_2);
    assert.equal(rotated.json().connection.keyLast4, '2222');
    assert.ok(db.aiProviderConnection.rows[0].rotatedAt instanceof Date);

    const event = db.auditEvent.rows.find((row) => row.action === 'ai.connection_rotated');
    assert.deepEqual(event.metadata, { keyLast4: '2222', previousKeyLast4: '1111', baseUrlHost: 'llm.example.com' });
    assertNoKeyAnywhere(rejected.body, rotated.body);
  });

  it('validate disables a connection whose key is rejected and re-activates it on success', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const { encrypt } = await import('../../utils/crypto.js');
    db.aiProviderConnection.rows[0].encryptedApiKey = encrypt(BAD_KEY);

    const failed = await send(app, 'adminA', 'POST', '/validate');
    assert.equal(failed.statusCode, 200);
    assert.equal(failed.json().valid, false);
    assert.equal(failed.json().errorType, 'auth');
    assert.equal(db.aiProviderConnection.rows[0].status, 'disabled');
    assert.equal(db.aiProviderConnection.rows[0].disabledReason, 'validation_failed:auth');

    db.aiProviderConnection.rows[0].encryptedApiKey = encrypt(GOOD_KEY);
    const ok = await send(app, 'adminA', 'POST', '/validate');
    assert.equal(ok.json().valid, true);
    assert.equal(db.aiProviderConnection.rows[0].status, 'active');
    const results = db.auditEvent.rows.filter((row) => row.action === 'ai.connection_validated').map((row) => row.metadata.result);
    assert.deepEqual(results, ['failed', 'ok']);
    assertNoKeyAnywhere(failed.body, ok.body);
  });

  it('revoke wipes the ciphertext and leaves a revoked record', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const response = await send(app, 'adminA', 'POST', '/revoke');
    assert.equal(response.statusCode, 200);
    const [row] = db.aiProviderConnection.rows;
    assert.equal(row.encryptedApiKey, null);
    assert.equal(row.status, 'revoked');
    assert.ok(row.revokedAt instanceof Date);
    assert.equal(response.json().connection.hasKey, false);
    assert.equal(db.auditEvent.rows.at(-1).action, 'ai.connection_revoked');

    assert.equal((await send(app, 'adminA', 'POST', '/revoke')).statusCode, 404);
    assert.equal((await send(app, 'adminA', 'POST', '/validate')).statusCode, 404);
    assert.equal((await send(app, 'adminA', 'POST', '/rotate', { apiKey: GOOD_KEY_2 })).statusCode, 404);
  });
});

describe('settings and kill switch', () => {
  it('updates models and budget, keeping the default inside the allowed list', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const bad = await send(app, 'adminA', 'PATCH', '/settings', { allowedModels: ['model-b'] });
    assert.equal(bad.statusCode, 400);
    const ok = await send(app, 'adminA', 'PATCH', '/settings', { allowedModels: ['model-b'], defaultModel: 'model-b', monthlyBudgetCents: 900 });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().connection.defaultModel, 'model-b');
    assert.equal(ok.json().connection.monthlyBudgetCents, 900);
    const event = db.auditEvent.rows.at(-1);
    assert.equal(event.action, 'ai.connection_settings_changed');
    assert.deepEqual(event.metadata, { fromDefaultModel: 'model-a', toDefaultModel: 'model-b', fromMonthlyBudgetCents: 5000, toMonthlyBudgetCents: 900, allowedModelCount: 1 });
  });

  it('the organization kill switch toggles only the caller\'s organization and is audited', async (t) => {
    const app = await buildApp(t);
    const off = await send(app, 'adminA', 'POST', '/disable');
    assert.equal(off.statusCode, 200);
    assert.equal(off.json().aiDisabled, true);
    assert.deepEqual(db.organization.rows.map((org) => [org.id, org.aiDisabled]), [['org-a', true], ['org-b', false]]);
    const on = await send(app, 'adminA', 'POST', '/enable');
    assert.equal(on.json().aiDisabled, false);
    assert.deepEqual(db.auditEvent.rows.map((row) => [row.action, row.entityId, row.metadata.scope]), [
      ['ai.disabled', 'org-a', 'organization'], ['ai.enabled', 'org-a', 'organization'],
    ]);
  });

  it('shows month-to-date usage against the budget', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const connectionId = db.aiProviderConnection.rows[0].id;
    db.aiUsageRecord.rows.push(
      { organizationId: 'org-a', connectionId, estimatedCostCents: 12.5, promptTokens: 100, completionTokens: 50, createdAt: new Date(), success: true },
      { organizationId: 'org-a', connectionId, estimatedCostCents: null, promptTokens: 7, completionTokens: 3, createdAt: new Date(), success: true },
      { organizationId: 'org-b', connectionId: 'other', estimatedCostCents: 999, promptTokens: 1, completionTokens: 1, createdAt: new Date(), success: true },
    );
    const { usage } = (await send(app, 'adminA', 'GET', '/')).json();
    assert.equal(usage.spentCents, 12.5);
    assert.equal(usage.budgetCents, 5000);
    assert.equal(usage.promptTokens, 107);
    assert.equal(usage.unpricedTokens, 10);
    assert.equal(usage.calls, 2);
  });
});

describe('tenant isolation', () => {
  it('organization B cannot read or change organization A\'s connection', async (t) => {
    const app = await buildApp(t);
    await connect(app);
    const before = { ...db.aiProviderConnection.rows[0] };

    const view = await send(app, 'adminB', 'GET', '/');
    assert.equal(view.json().connection, null);
    assert.equal(view.json().usage.budgetCents, null);
    assert.equal((await send(app, 'adminB', 'POST', '/validate')).statusCode, 404);
    assert.equal((await send(app, 'adminB', 'POST', '/rotate', { apiKey: GOOD_KEY_2 })).statusCode, 404);
    assert.equal((await send(app, 'adminB', 'POST', '/revoke')).statusCode, 404);
    assert.equal((await send(app, 'adminB', 'PATCH', '/settings', { monthlyBudgetCents: 1 })).statusCode, 404);
    await send(app, 'adminB', 'POST', '/disable');

    assert.deepEqual(db.aiProviderConnection.rows[0], before);
    assert.equal(db.organization.rows.find((org) => org.id === 'org-a').aiDisabled, false);

    // B connecting its own provider creates B's row; A's stays as it was.
    assert.equal((await connect(app, 'adminB', { ...CONNECT_BODY, apiKey: GOOD_KEY_2 })).statusCode, 201);
    assert.deepEqual(db.aiProviderConnection.rows.map((row) => row.organizationId), ['org-a', 'org-b']);
    assert.equal(decrypt(db.aiProviderConnection.rows[0].encryptedApiKey), GOOD_KEY);
    assert.equal(db.auditEvent.rows.filter((row) => row.organizationId === 'org-a').every((row) => row.actorUserId === 'user-admin-a'), true);
  });

  it('a forged organizationId in the body is rejected', async (t) => {
    const app = await buildApp(t);
    const response = await connect(app, 'adminB', { ...CONNECT_BODY, organizationId: 'org-a' });
    assert.equal(response.statusCode, 400);
    assert.equal(db.aiProviderConnection.rows.length, 0);
  });
});
