// Clear errors when AI is not set up, and the workflows that used to break or
// fail silently because of it: paste intake, Gmail reply, onboarding links.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';

const {
  AiUnavailableError, AiProviderError, isAiControlError, isPlatformSetupFailure,
} = await import('../../ai/errors.js');
const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const { default: aiClient } = await import('../../ai/client.js');
const { default: env } = await import('../../config/env.js');
const { gmailSendSchema } = await import('../../validators/schemas.js');
const {
  default: gmailRoutes, gmailConnectionFor, replySignature, GMAIL_NOT_CONNECTED,
} = await import('../../routes/gmail.routes.js');
const { default: messageRoutes } = await import('../../routes/message.routes.js');
const { tasksForRole } = await import('../../routes/onboarding.routes.js');

const AI_UNAVAILABLE_TEXT = "AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings.";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function unconfiguredPlatform() {
  return {
    isConfigured: () => false,
    chat: async () => { throw new Error('must not be called'); },
    chatJSON: async () => { throw new Error('must not be called'); },
  };
}

// ---------------------------------------------------------------- AI errors

test('AiUnavailableError is a 503 AI_UNAVAILABLE control error with a message people can act on', () => {
  const err = new AiUnavailableError();
  assert.equal(isAiControlError(err), true);
  assert.equal(err.statusCode, 503);
  assert.equal(err.code, 'AI_UNAVAILABLE');
  assert.equal(err.message, AI_UNAVAILABLE_TEXT);
});

test('setup failures are told apart from ordinary provider trouble', () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:11434'), { code: 'ECONNREFUSED' }) });
  assert.equal(isPlatformSetupFailure(refused), true);
  assert.equal(isPlatformSetupFailure(Object.assign(new Error('bad key'), { status: 401 })), true);
  assert.equal(isPlatformSetupFailure(new Error('Ollama API error 401: unauthorized')), true);
  assert.equal(isPlatformSetupFailure(Object.assign(new Error('slow'), { name: 'TimeoutError' })), false);
  assert.equal(isPlatformSetupFailure(Object.assign(new Error('busy'), { status: 429 })), false);
  assert.equal(isPlatformSetupFailure(new AiProviderError('auth')), false);
});

test('governance answers AI_UNAVAILABLE when the platform provider has no key, without calling it', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: unconfiguredPlatform }));
  await assert.rejects(aiClient.chatJSON({ system: 's', prompt: 'p' }), (err) => err.code === 'AI_UNAVAILABLE' && err.statusCode === 503);
  await assert.rejects(aiClient.chat({ system: 's', prompt: 'p' }), (err) => err instanceof AiUnavailableError);
});

test('governance answers AI_UNAVAILABLE when nothing listens at the platform provider address', async (t) => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  t.after(await installFakeGovernance(createFakeAiDb(), {
    platformProvider: () => ({ isConfigured: () => true, chat: async () => { throw refused; }, chatJSON: async () => { throw refused; } }),
  }));
  await assert.rejects(aiClient.chat({ system: 's', prompt: 'p' }), (err) => err.code === 'AI_UNAVAILABLE');
});

test('other platform failures keep reaching the route unchanged', async (t) => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  t.after(await installFakeGovernance(createFakeAiDb(), {
    platformProvider: () => ({ isConfigured: () => true, chat: async () => { throw timeout; } }),
  }));
  await assert.rejects(aiClient.chat({ system: 's', prompt: 'p' }), (err) => err === timeout);
});

test('platform providers report whether they have what they need', async () => {
  const { default: ClaudeProvider } = await import('../../ai/providers/claude.js');
  const { default: GeminiProvider } = await import('../../ai/providers/gemini.js');
  const { default: OllamaProvider } = await import('../../ai/providers/ollama.js');
  const saved = { anthropic: env.anthropicApiKey, gemini: env.geminiApiKey, ollamaKey: env.ollamaApiKey, ollamaUrl: env.ollamaBaseUrl };
  try {
    env.anthropicApiKey = undefined;
    env.geminiApiKey = undefined;
    assert.equal(new ClaudeProvider().isConfigured(), false);
    assert.equal(new GeminiProvider().isConfigured(), false);
    env.anthropicApiKey = 'sk-test';
    assert.equal(new ClaudeProvider().isConfigured(), true);

    env.ollamaApiKey = undefined;
    env.ollamaBaseUrl = 'https://ollama.com';
    assert.equal(new OllamaProvider().isConfigured(), false, 'hosted Ollama needs a key');
    env.ollamaBaseUrl = 'http://localhost:11434';
    assert.equal(new OllamaProvider().isConfigured(), true, 'a self-hosted server needs no key');
  } finally {
    env.anthropicApiKey = saved.anthropic;
    env.geminiApiKey = saved.gemini;
    env.ollamaApiKey = saved.ollamaKey;
    env.ollamaBaseUrl = saved.ollamaUrl;
  }
});

// ---------------------------------------------------------------- paste

// Rows written inside $transaction are kept only when the callback succeeds.
function pastePrisma({ failTaskNumber = 0 } = {}) {
  const threads = [];
  const tasks = [];
  const delegates = (threadRows, taskRows) => ({
    thread: { create: async ({ data }) => { const row = { id: `thr-${threads.length + threadRows.length + 1}`, ...data }; threadRows.push(row); return row; } },
    task: {
      create: async ({ data }) => {
        if (failTaskNumber && tasks.length + taskRows.length + 1 === failTaskNumber) throw new Error('task insert failed');
        const row = { id: `task-${tasks.length + taskRows.length + 1}`, ...data };
        taskRows.push(row);
        return row;
      },
    },
  });
  return {
    threads,
    tasks,
    project: { findUnique: async ({ where }) => (where.id === 'proj-1' ? { clientId: 'client-1' } : null) },
    ...delegates(threads, tasks),
    $transaction: async (callback) => {
      const pendingThreads = [];
      const pendingTasks = [];
      const result = await callback(delegates(pendingThreads, pendingTasks));
      threads.push(...pendingThreads);
      tasks.push(...pendingTasks);
      return result;
    },
  };
}

async function pasteApp(prisma) {
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'TEAM' }; });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(messageRoutes);
  return app;
}

test('paste saves the client message even when AI is not set up, and says analysis failed', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: unconfiguredPlatform }));
  const prisma = pastePrisma();
  const app = await pasteApp(prisma);
  t.after(() => app.close());

  const content = 'Can we move the launch to Friday?\nAlso the logo looks blurry.';
  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content, source: 'slack', projectId: 'proj-1' } });
  assert.equal(response.statusCode, 201, response.body);
  const body = response.json();
  assert.equal(body.analysis.status, 'failed');
  assert.equal(body.analysis.code, 'AI_UNAVAILABLE');
  assert.equal(body.analysis.error, AI_UNAVAILABLE_TEXT);
  assert.equal(body.extracted, null);
  assert.deepEqual(body.createdTasks, []);

  assert.equal(prisma.threads.length, 1);
  const saved = prisma.threads[0];
  assert.equal(saved.clientId, 'client-1');
  assert.equal(saved.projectId, 'proj-1');
  assert.equal(saved.needsTriage, true);
  assert.equal(saved.subject, '[SLACK] Can we move the launch to Friday?');
  assert.equal(saved.messages.create.bodyText, content);
  assert.deepEqual(JSON.parse(saved.messages.create.aiExtracted), { source: 'slack', analysisStatus: 'failed', analysisErrorCode: 'AI_UNAVAILABLE' });
});

test('paste also keeps the message when the AI call fails for another reason', async (t) => {
  const original = aiClient.chatJSON;
  aiClient.chatJSON = async () => { throw new Error('AI returned invalid JSON'); };
  t.after(() => { aiClient.chatJSON = original; });
  const prisma = pastePrisma();
  const app = await pasteApp(prisma);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content: 'Ping', projectId: 'proj-1' } });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().analysis.code, 'AI_ANALYSIS_FAILED');
  assert.match(response.json().analysis.error, /The message itself was saved/);
  assert.equal(prisma.threads[0].messages.create.bodyText, 'Ping');
});

test('paste with working AI still files the thread and creates tasks', async (t) => {
  const original = aiClient.chatJSON;
  aiClient.chatJSON = async () => ({
    summary: 'Client wants a Friday launch',
    sender: { name: 'Olivia', email: 'olivia@northwind.test' },
    actionItems: [{ task: 'Confirm Friday launch', priority: 'HIGH', dueDate: 'not a date' }],
    suggestedIntent: 'question',
  });
  t.after(() => { aiClient.chatJSON = original; });
  const prisma = pastePrisma();
  const app = await pasteApp(prisma);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content: 'Friday?', source: 'email', projectId: 'proj-1' } });
  assert.equal(response.statusCode, 201, response.body);
  assert.equal(response.json().analysis.status, 'complete');
  assert.equal(prisma.threads[0].subject, '[EMAIL] Client wants a Friday launch');
  assert.equal(prisma.tasks.length, 1);
  assert.equal(prisma.tasks[0].dueDate, null, 'an unreadable date is dropped, not stored as Invalid Date');
});

test('paste without a project answers with the clear AI error instead of a 500', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: unconfiguredPlatform }));
  const app = await pasteApp(pastePrisma());
  t.after(() => app.close());
  const response = await app.inject({ method: 'POST', url: '/paste', payload: { content: 'Hello' } });
  assert.equal(response.statusCode, 503, response.body);
  assert.deepEqual(response.json(), { error: AI_UNAVAILABLE_TEXT, code: 'AI_UNAVAILABLE' });
});

// ---------------------------------------------------------------- Gmail

test('the Gmail send schema accepts the nulls a hub-only thread sends', () => {
  const parsed = gmailSendSchema.safeParse({
    to: 'olivia@northwind.test', subject: 'Re: launch', body: 'Hi', threadId: null, in_reply_to: null, hubThreadId: 'thr-1',
  });
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
  assert.equal(gmailSendSchema.safeParse({ to: 'olivia@northwind.test', subject: 's', body: 'b' }).success, true);
  // Real Gmail thread ids are hex strings, not cuids.
  assert.equal(gmailSendSchema.safeParse({ to: 'a@b.co', subject: 's', body: 'b', threadId: '18c2f0a9b3d4e5f6' }).success, true);
});

test('Gmail counts as connected only for the owning workspace and only with tokens', () => {
  const saved = env.gmailSyncOrganizationId;
  try {
    env.gmailSyncOrganizationId = 'org-owner';
    assert.deepEqual(gmailConnectionFor({ organizationId: 'org-other' }, { readTokens: () => ({ refresh_token: 'r' }) }), { connected: false, reason: 'other_organization' });
    assert.deepEqual(gmailConnectionFor({ organizationId: 'org-owner' }, { readTokens: () => ({ refresh_token: 'r' }) }), { connected: true });
    assert.deepEqual(gmailConnectionFor({ organizationId: 'org-owner' }, { readTokens: () => { throw new Error('ENOENT'); } }), { connected: false, reason: 'no_tokens' });
    // Fails closed: with no owner configured, nobody is connected, even with tokens.
    env.gmailSyncOrganizationId = undefined;
    assert.deepEqual(gmailConnectionFor({ organizationId: 'org-a' }, { readTokens: () => ({ refresh_token: 'r' }) }), { connected: false, reason: 'not_configured' });
  } finally {
    env.gmailSyncOrganizationId = saved;
  }
});

test('the reply signature is the person and the workspace, never a fixed name', () => {
  assert.equal(replySignature({ name: 'Pat Lee' }, 'Northwind Studio'), 'Pat Lee\nNorthwind Studio');
  assert.equal(replySignature({ name: '' }, 'Northwind Studio'), 'Northwind Studio');
  assert.equal(replySignature(null, ''), '');
});

async function gmailApp({ organizationName = 'Northwind Studio' } = {}) {
  const app = Fastify();
  const prisma = {
    organization: { findUnique: async () => ({ name: organizationName }) },
    thread: {
      findFirst: async () => ({ id: 'thr-1' }),
      findUnique: async () => ({
        id: 'thr-1',
        subject: 'Launch date',
        client: { name: 'Northwind' },
        messages: [{ direction: 'INBOUND', senderEmail: 'olivia@northwind.test', bodyText: 'Friday?', aiExtracted: null }],
      }),
    },
  };
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'u1', name: 'Pat Lee', email: 'pat@studio.test', organizationId: 'org-a', role: 'TEAM' };
  });
  app.decorate('adminOnly', async () => {});
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(gmailRoutes);
  return app;
}

test('sending without a connected mailbox is refused with a reason and what to do', async (t) => {
  const saved = env.gmailSyncOrganizationId;
  env.gmailSyncOrganizationId = 'org-owner';
  t.after(() => { env.gmailSyncOrganizationId = saved; });
  const app = await gmailApp();
  t.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/send',
    payload: { to: 'olivia@northwind.test', subject: 'Re: Launch date', body: 'Friday works.', threadId: null, in_reply_to: null, hubThreadId: 'thr-1' },
  });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, GMAIL_NOT_CONNECTED);
  assert.match(response.json().error, /Gmail isn't connected/);
  assert.doesNotMatch(response.body, /Expected string, received null/);

  const status = await app.inject({ method: 'GET', url: '/status' });
  assert.equal(status.json().connected, false);
  assert.equal(status.json().code, GMAIL_NOT_CONNECTED);
});

test('the Gmail draft signs as the person and workspace, and says when AI could not write it', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: unconfiguredPlatform }));
  const app = await gmailApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/draft-reply', payload: { hubThreadId: 'thr-1' } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.match(body.draft, /Best,\nPat Lee\nNorthwind Studio$/);
  assert.doesNotMatch(body.draft, /Cameron|Ashbi Design/);
  assert.equal(body.notice.code, 'AI_UNAVAILABLE');
  assert.match(body.notice.message, /AI isn't set up for this workspace yet.*template reply/);
  assert.equal(body.gmailThreadId, null);
});

test('the AI writing a Gmail draft is told the real signature', async (t) => {
  let system = '';
  t.after(await installFakeGovernance(createFakeAiDb(), {
    platformProvider: () => ({ isConfigured: () => true, chat: async (options) => { system = options.system; return 'Hi Olivia,\n\nFriday works.\n\nBest,\nPat Lee\nNorthwind Studio'; } }),
  }));
  const app = await gmailApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/draft-reply', payload: { hubThreadId: 'thr-1' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().notice, null);
  assert.match(system, /Pat Lee\nNorthwind Studio/);
  assert.doesNotMatch(system, /Cameron|Ashbi Design/);
});

test('the Gmail routes no longer hard-code a sender', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'src/routes/gmail.routes.js'), 'utf8');
  assert.doesNotMatch(source, /cameron@ashbi\.ca|Cameron \| Ashbi Design/);
});

// ---------------------------------------------------------------- onboarding

test('every onboarding task links to a page that exists in the web app', () => {
  const app = fs.readFileSync(path.join(repoRoot, 'web/src/App.jsx'), 'utf8');
  const routes = new Set([...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]));
  for (const role of ['ADMIN', 'TEAM']) {
    for (const task of tasksForRole(role)) {
      assert.ok(routes.has(task.href), `${role} task ${task.id} links to ${task.href}, which is not a route`);
    }
  }
  const team = Object.fromEntries(tasksForRole('TEAM').map((task) => [task.id, task.href]));
  assert.equal(team['complete-task'], '/queue');
  assert.equal(team['log-time'], '/timesheets');
});

// ---------------------------------------------------------------- AI routes

test('thread AI draft, client update draft and contract refine all answer 503 AI_UNAVAILABLE with the readable message', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: unconfiguredPlatform }));
  const { default: aiRoutes } = await import('../../routes/ai.routes.js');
  const empty = { findMany: async () => [] };
  const prisma = {
    thread: {
      findUnique: async () => ({
        id: 'thr-1', subject: 'Launch', priority: 'NORMAL', aiAnalysis: null, client: { name: 'Northwind' }, project: null,
        messages: [{ direction: 'INBOUND', senderEmail: 'o@n.test', bodyText: 'Friday?', receivedAt: new Date() }],
      }),
      findMany: async () => [],
    },
    project: {
      findUnique: async () => ({ id: 'proj-1', name: 'Rebrand', status: 'ACTIVE', health: 'ON_TRACK', client: { name: 'Northwind' }, tasks: [], revisionRounds: [] }),
      findMany: async () => [],
    },
    task: empty,
    retainerPlan: empty,
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => { request.user = { id: 'u1', organizationId: 'org-a', role: 'ADMIN' }; });
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(aiRoutes);
  t.after(() => app.close());

  // Contracts' "AI refine" posts to /chat.
  const calls = [
    { url: '/draft-response', payload: { threadId: 'thr-1' } },
    { url: '/draft-update', payload: { projectId: 'proj-1', rawNotes: 'Logo round two is done.' } },
    { url: '/chat', payload: { message: 'Make the payment terms net 15.' } },
  ];
  for (const { url, payload } of calls) {
    const response = await app.inject({ method: 'POST', url, payload });
    assert.equal(response.statusCode, 503, `${url}: ${response.body}`);
    assert.deepEqual(response.json(), { error: AI_UNAVAILABLE_TEXT, code: 'AI_UNAVAILABLE' }, url);
  }
});
