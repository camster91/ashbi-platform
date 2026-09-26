// AI tool approval queue and receipts API (#413 slice 2, docs/ai-tool-registry.md).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'unit-test-credentials-key';

const { default: aiToolRoutes } = await import('../../routes/ai-tool.routes.js');
const { createToolExecutor } = await import('../../ai/tools/executor.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { createFakeToolDb, seedTwoOrganizations } = await import('../helpers/fake-tool-db.js');

const USERS = {
  adminA: { id: 'admin-a', role: 'ADMIN', organizationId: 'org-a' },
  teamA: { id: 'team-a', role: 'TEAM', organizationId: 'org-a' },
  team2A: { id: 'team2-a', role: 'TEAM', organizationId: 'org-a' },
  adminB: { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b' },
  clientA: { id: 'client-user-a', role: 'CLIENT', organizationId: 'org-a' },
};

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

async function setup(t, { governance = { assertAllowed: async () => {} } } = {}) {
  const db = seedTwoOrganizations(createFakeToolDb());
  const executor = createToolExecutor({ governance, logger: quiet, deps: { decryptSecret: () => 'token', postSlackMessage: async () => ({ channelId: 'CA1', slackTs: '1.1' }) } });
  const app = Fastify();
  await app.register(cookie);
  app.decorate('authenticate', async (request, reply) => {
    const user = USERS[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = withSession(user);
    request.prisma = createScopedPrisma(db, user.organizationId);
    return undefined;
  });
  await app.register(aiToolRoutes, { toolExecutor: executor });
  t.after(() => app.close());
  const ctx = (key) => ({ prisma: createScopedPrisma(db, USERS[key].organizationId), user: USERS[key], requestId: `req-${key}` });
  const prepare = async (key, title = 'Draft copy', idempotencyKey = `key-${key}-${title.length}-0001`) => (await executor.invoke(ctx(key), {
    tool: 'create_task', input: { projectId: `project-${USERS[key].organizationId.slice(-1)}`, title }, idempotencyKey, source: 'assistant',
  })).action;
  const send = (key, method, url, payload, { reauth = true } = {}) => app.inject({
    method, url, payload, headers: key ? { 'x-test-user': key } : {}, cookies: key && reauth ? reauthCookies(USERS[key]) : {},
  });
  return { db, app, prepare, send };
}

describe('AI tool approval queue', () => {
  it('lists the tool catalogue for staff only', async (t) => {
    const { send } = await setup(t);
    const response = await send('teamA', 'GET', '/catalog');
    assert.equal(response.statusCode, 200);
    const slack = response.json().tools.find((tool) => tool.name === 'send_slack_message');
    assert.deepEqual([slack.class, slack.external, slack.requiresConfirmation, slack.maxAttempts], ['execute', true, true, 1]);
    assert.equal((await send('clientA', 'GET', '/catalog')).statusCode, 403);
    assert.equal((await send(null, 'GET', '/catalog')).statusCode, 401);
  });

  it('shows an ADMIN every pending action and a TEAM member only their own', async (t) => {
    const { send, prepare } = await setup(t);
    await prepare('teamA', 'Team A task');
    await prepare('team2A', 'Second member task');
    await prepare('adminB', 'Org B task');

    const admin = (await send('adminA', 'GET', '/approvals')).json().approvals;
    assert.deepEqual(admin.map((row) => row.requesterId).sort(), ['team-a', 'team2-a']);
    assert.equal(admin[0].requesterName !== null, true);
    assert.deepEqual([admin[0].external, admin[0].irreversible], [false, false]);
    const team = (await send('teamA', 'GET', '/approvals')).json().approvals;
    assert.deepEqual(team.map((row) => row.requesterId), ['team-a']);
    const other = admin.find((row) => row.requesterId === 'team2-a');
    assert.equal((await send('teamA', 'GET', `/approvals/${other.id}`)).statusCode, 404);
    assert.equal((await send('adminB', 'GET', `/approvals/${other.id}`)).statusCode, 404);
    assert.equal((await send('adminA', 'GET', `/approvals/${other.id}`)).statusCode, 200);
  });

  it('requires step-up re-authentication to approve or reject', async (t) => {
    const { send, prepare, db } = await setup(t);
    const action = await prepare('teamA');
    for (const verb of ['approve', 'reject']) {
      const response = await send('teamA', 'POST', `/approvals/${action.id}/${verb}`, {}, { reauth: false });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().code, 'REAUTH_REQUIRED');
    }
    assert.equal(db.tables.aiBridgeAction[0].status, 'PENDING_CONFIRMATION');
  });

  it('executes on approval, stores the receipt and lists it', async (t) => {
    const { send, prepare, db } = await setup(t);
    const action = await prepare('teamA');
    const approved = await send('adminA', 'POST', `/approvals/${action.id}/approve`, {});
    assert.equal(approved.statusCode, 200);
    const receipt = approved.json().action;
    assert.equal(receipt.status, 'EXECUTED');
    assert.equal(receipt.outcome, 'succeeded');
    assert.equal(receipt.approverId, 'admin-a');
    assert.equal(receipt.requesterId, 'team-a');
    assert.equal(receipt.approvalEvidence.method, 'session_step_up');
    assert.equal(receipt.approvalEvidence.reauthenticated, true);
    assert.deepEqual(receipt.inputScope, { projectId: 'project-a' });
    assert.equal(db.tables.task.filter((task) => task.title === 'Draft copy').length, 1);

    const again = await send('adminA', 'POST', `/approvals/${action.id}/approve`, {});
    assert.equal(again.json().idempotent, true);

    const receipts = (await send('adminA', 'GET', '/receipts?status=EXECUTED&tool=create_task')).json().receipts;
    assert.deepEqual(receipts.map((row) => row.id), [action.id]);
    assert.deepEqual((await send('adminA', 'GET', '/receipts?outcome=unknown')).json().receipts, []);
    assert.deepEqual((await send('adminB', 'GET', '/receipts')).json().receipts, []);
    assert.equal((await send('adminA', 'GET', '/receipts?status=bogus')).statusCode, 400);
  });

  it('lets the requester reject their own action with a reason, and keeps rejections final', async (t) => {
    const { send, prepare } = await setup(t);
    const action = await prepare('teamA');
    const rejected = await send('teamA', 'POST', `/approvals/${action.id}/reject`, { reason: 'incorrect' });
    assert.equal(rejected.statusCode, 200);
    assert.equal(rejected.json().action.status, 'REJECTED');
    assert.equal(rejected.json().action.approvalEvidence.reason, 'incorrect');
    const late = await send('teamA', 'POST', `/approvals/${action.id}/approve`, {});
    assert.equal(late.statusCode, 409);
    assert.equal(late.json().code, 'ACTION_UNAVAILABLE');
    assert.equal((await send('teamA', 'POST', `/approvals/${action.id}/reject`, { reason: 'free text is not allowed' })).statusCode, 400);
  });

  it('refuses approval while AI is switched off', async (t) => {
    const { AiDisabledError } = await import('../../ai/errors.js');
    const { send, db } = await setup(t, { governance: { assertAllowed: async () => { throw new AiDisabledError('organization'); } } });
    db.tables.aiBridgeAction.push({
      id: 'pending-1', organizationId: 'org-a', userId: 'team-a', action: 'create_task', idempotencyKey: 'manual-0001',
      input: { projectId: 'project-a', title: 'x' }, inputHash: 'h', preview: {}, status: 'PENDING_CONFIRMATION',
      expiresAt: new Date(Date.now() + 60_000), source: 'assistant', toolClass: 'execute', createdAt: new Date(),
    });
    const response = await send('adminA', 'POST', '/approvals/pending-1/approve', {});
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, 'AI_DISABLED');
    assert.equal(db.tables.aiBridgeAction[0].status, 'PENDING_CONFIRMATION');
  });
});
