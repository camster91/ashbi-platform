// AI prompts and AI-generated text name the signed-in person and their
// organization, never one agency's people or name. Assignee concepts are role
// tokens (account_lead), not a person.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import Fastify from 'fastify';

// The Maton key is read at module load by the Gmail draft agent.
process.env.MATON_API_KEY ||= 'test-key';

const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const { buildAnalyzeMessagePrompt } = await import('../../ai/prompts/analyzeMessage.js');
const { buildDraftResponsePrompt } = await import('../../ai/prompts/draftResponse.js');
const { buildReplanProjectPrompt } = await import('../../ai/prompts/replanProject.js');
const { AGENTS, agentSystemPrompt } = await import('../../routes/ai-team.routes.js');
const { ashSystemPrompt } = await import('../../routes/ash-chat.routes.js');
const { runWeeklyDigest } = await import('../../jobs/weekly-digest.js');
const { generateProposal, createProposalDraft } = await import('../../agents/proposal-builder.agent.js');

const NAMES = /Ashbi Design|Cameron|Bianca|\bcameron\b|\bbianca\b/i;
const USER = { id: 'u1', name: 'Pat Lee', email: 'pat@studio.test', organizationId: 'org-1', role: 'ADMIN' };
const ORG = 'Northwind Studio';

function assertNoNames(text, label) {
  assert.doesNotMatch(text, NAMES, label);
}

function captureAi() {
  const seen = [];
  const provider = {
    isConfigured: () => true,
    chat: async (options) => { seen.push(options); return 'ok'; },
    chatJSON: async (options) => {
      seen.push(options);
      return { options: [{ subject: 'Re: hi', body: 'Hello', tone: 'friendly' }], tags: ['client'], summary: 's', title: 'Proposal' };
    },
  };
  return { seen, platformProvider: () => provider };
}

const message = { subject: 'Logo', senderEmail: 'ada@contoso.test', senderName: 'Ada', bodyText: 'Can we change the logo colour?' };
const analysis = { intent: 'question', urgency: 'NORMAL', sentiment: 'neutral', summary: 'Logo colour', questionsToAnswer: [], responseApproach: { keyPointsToAddress: [] } };

// ---------------------------------------------------------------- builders

test('the analyze, draft and replan prompts use role tokens and no hard-coded names', () => {
  const analyze = buildAnalyzeMessagePrompt({ message });
  assertNoNames(`${analyze.system}\n${analyze.prompt}`, 'analyzeMessage');
  assert.match(analyze.prompt, /"assignmentSuggestion": "dev\|design\|account_lead\|anyone"/);

  const replan = buildReplanProjectPrompt({ project: { name: 'Rebrand', status: 'ACTIVE' }, threads: [], newMessage: message });
  assertNoNames(`${replan.system}\n${replan.prompt}`, 'replanProject');
  assert.match(replan.prompt, /"suggestedAssignee": "dev\|design\|account_lead"/);

  const anonymous = buildDraftResponsePrompt({ message, analysis });
  assertNoNames(`${anonymous.system}\n${anonymous.prompt}`, 'draftResponse');
  assert.match(anonymous.system, /Leave the signature for the sender to add/);

  const signed = buildDraftResponsePrompt({ message, analysis, sender: USER, organizationName: ORG });
  assertNoNames(`${signed.system}\n${signed.prompt}`, 'draftResponse (signed)');
  assert.match(signed.system, /on behalf of Pat Lee at Northwind Studio/);
  assert.match(signed.system, /Sign each option as Pat Lee, Northwind Studio\./);
});

test('AI team agents and Ash name the workspace and sign as the person', () => {
  for (const agent of AGENTS) {
    const prompt = agentSystemPrompt(agent, USER, ORG);
    assertNoNames(prompt, agent.role);
    assert.match(prompt, /Northwind Studio's/, agent.role);
    assert.doesNotMatch(prompt, /\{agency\}|\{signOff\}/, agent.role);
    assertNoNames(agentSystemPrompt(agent, null, ''), `${agent.role} (anonymous)`);
  }
  const sales = AGENTS.find((agent) => agent.role === 'SALES');
  assert.match(agentSystemPrompt(sales, USER, ORG), /Sign off as Pat Lee, Northwind Studio\./);

  assert.match(ashSystemPrompt(ORG), /Chief of Staff at Northwind Studio/);
  assertNoNames(ashSystemPrompt(''), 'ash (no organization)');
});

// ---------------------------------------------------------------- routes

async function app(t, register) {
  const { seen, platformProvider } = captureAi();
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider }));
  const prisma = {
    organization: { findUnique: async () => ({ name: ORG }) },
    client: { findUnique: async () => ({ id: 'client-1', name: 'Contoso' }) },
    thread: {
      findUnique: async () => ({
        id: 'thr-1', priority: 'NORMAL', aiAnalysis: null, client: { name: 'Contoso' }, project: null,
        messages: [{ ...message, receivedAt: new Date() }],
      }),
      findMany: async () => [{ id: 'thr-2', subject: 'Hello', messages: [message] }],
    },
    response: { create: async ({ data }) => ({ id: 'resp-1', ...data }) },
    emailTriageItem: {
      findMany: async () => [],
      findUnique: async () => ({ id: 'item-1', subject: 'Hello', senderEmail: 'ada@contoso.test', bodyText: 'Hi' }),
      create: async ({ data }) => ({ id: 'item-2', ...data }),
    },
    emailTriageDraft: { create: async ({ data }) => ({ id: 'draft-1', ...data }) },
  };
  const fastify = Fastify();
  fastify.decorate('authenticate', async (request) => { request.user = { ...USER }; });
  fastify.decorate('adminOnly', async () => {});
  fastify.decorate('prisma', prisma);
  fastify.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await register(fastify);
  t.after(() => fastify.close());
  return { fastify, seen };
}

test('the proposal generator and AI draft name the person and workspace, not one agency', async (t) => {
  const { default: aiRoutes } = await import('../../routes/ai.routes.js');
  const { fastify, seen } = await app(t, (f) => f.register(aiRoutes, { prefix: '/ai' }));

  for (const [url, payload] of [
    ['/ai/generate-proposal', { clientId: 'client-1', brief: 'New packaging' }],
    ['/ai/draft-response', { threadId: 'thr-1' }],
  ]) {
    const before = seen.length;
    const response = await fastify.inject({ method: 'POST', url, payload });
    assert.ok(response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
    assert.equal(seen.length, before + 1, `${url} made one AI call`);
    const { system = '', prompt = '' } = seen.at(-1);
    assertNoNames(`${system}\n${prompt}`, url);
    assert.match(`${system}\n${prompt}`, /Pat Lee/, url);
    assert.match(`${system}\n${prompt}`, /Northwind Studio/, url);
  }
  const proposal = seen.at(-2);
  assert.match(proposal.prompt, /About Northwind Studio/);
  assert.match(proposal.prompt, /Sign the proposal as Pat Lee, Northwind Studio\./);
});

test('email triage scans and drafts for the person and workspace', async (t) => {
  const { default: emailTriageRoutes } = await import('../../routes/email-triage.routes.js');
  const { fastify, seen } = await app(t, (f) => f.register(emailTriageRoutes));

  const scan = await fastify.inject({ method: 'POST', url: '/scan', payload: {} });
  assert.equal(scan.statusCode, 200, scan.body);
  const draft = await fastify.inject({ method: 'POST', url: '/draft/item-1' });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.equal(seen.length, 2);
  for (const { system, prompt } of seen) {
    assertNoNames(`${system}\n${prompt}`, 'email triage');
    assert.match(system, /Pat Lee at Northwind Studio/);
  }
  assert.match(seen[0].prompt, /"needs-reply" means Pat Lee should respond/);
  assert.match(seen[1].prompt, /Sign as Pat Lee, Northwind Studio\./);
});

// ---------------------------------------------------------------- jobs and agents

test('the weekly digest is written for the organization, not one agency', async () => {
  const zero = { count: async () => 0 };
  const client = {
    organization: {
      findMany: async () => [{ id: 'org-1' }],
      findUnique: async ({ where }) => (where.id === 'org-1' ? { id: 'org-1', name: ORG } : null),
    },
    thread: zero, proposal: zero, task: zero,
    client: { findMany: async () => [] },
    retainerPlan: { findMany: async () => [] },
    weeklyDigest: { create: async ({ data }) => data },
  };
  const seen = [];
  await runWeeklyDigest({ prisma: client, backgroundPrisma: client, chat: async (options) => { seen.push(options); return 'digest'; } });
  assert.equal(seen.length, 1);
  assertNoNames(`${seen[0].system}\n${seen[0].prompt}`, 'weekly digest');
  assert.match(seen[0].system, /Northwind Studio/);
});

test('the proposal builder prompts and signs for the person and workspace', async (t) => {
  const { seen, platformProvider } = captureAi();
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider }));
  const proposal = await generateProposal(
    { name: 'Ada Lovelace', email: 'ada@contoso.test', projectType: 'branding', budget: '3000' },
    { sender: USER, organizationName: ORG },
  );
  assert.equal(seen.length, 1);
  assertNoNames(`${seen[0].system}\n${seen[0].prompt}`, 'proposal builder');
  assert.match(seen[0].system, /Pat Lee at Northwind Studio/);

  let raw;
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (String(url).endsWith('/profile')) return new Response('{}', { status: 404 });
    raw = JSON.parse(init.body).message.raw;
    return new Response(JSON.stringify({ id: 'draft-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  await createProposalDraft(proposal, 'ada@contoso.test', { sender: USER, organizationName: ORG });
  const mime = Buffer.from(raw.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8');
  const text = Buffer.from(mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(text, /Best,\nPat Lee\nNorthwind Studio$/);
  assertNoNames(text, 'proposal email');
});

// ---------------------------------------------------------------- source scan

test('no prompt-bearing module hard-codes one agency\'s people or name', () => {
  const files = [
    'ai/prompts/analyzeMessage.js',
    'ai/prompts/draftResponse.js',
    'ai/prompts/replanProject.js',
    'routes/ai.routes.js',
    'routes/ai-team.routes.js',
    'routes/ash-chat.routes.js',
    'routes/email-triage.routes.js',
    'routes/gmail.routes.js',
    'routes/invoice-chaser.routes.js',
    'routes/message.routes.js',
    'routes/project.routes.js',
    'jobs/weekly-digest.js',
    'agents/proposal-builder.agent.js',
    'webhooks/discord.js',
  ];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assertNoNames(source, file);
  }
});
