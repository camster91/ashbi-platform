import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientAgentRunService, listClientAgentRunAttentionForQueue } from '../../services/client-agent-run.service.js';
import { WORK_QUEUE_SOURCES, buildWorkQueue } from '../../services/work-queue.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const actor = { id: 'staff', organizationId: 'org', role: 'TEAM', name: 'Staff', isActive: true };
const client = { id: 'client', organizationId: 'org', deletedAt: null };
const conversation = { id: 'conversation', organizationId: 'org', clientId: client.id, sourceChannelId: null, sourceBindingId: null };
const now = new Date('2026-10-17T12:00:00Z');
const source = WORK_QUEUE_SOURCES.find(row => row.key === 'agent_runs');

function fixture(overrides = {}) {
  const state = { actor: { ...actor }, client: { ...client }, conversation: { ...conversation },
    row: { id: 'run', organizationId: 'org', conversationId: 'conversation', requestedById: 'staff', status: 'UNKNOWN',
      prompt: 'Private prompt', response: null, errorCode: 'PRIVATE_PROVIDER_ERROR', createdAt: now, attentionReview: null },
    reviews: [], audits: [], collisions: 0, ...overrides };
  const same = (row, where) => row && Object.entries(where).every(([key, value]) => row[key] === value || (value === null && row[key] == null));
  const db = {
    user: { findFirst: async ({ where }) => same(state.actor, where) ? state.actor : null },
    client: { findFirst: async ({ where }) => same(state.client, where) ? state.client : null },
    clientAgentConversation: { findFirst: async ({ where }) => same(state.conversation, where) ? state.conversation : null },
    clientAgentRun: { findFirst: async ({ where }) => same(state.row, where) ? structuredClone(state.row) : null },
    clientAgentRunReview: { create: async ({ data }) => {
      if (state.collisions-- > 0) {
        state.row.attentionReview = { reviewedAt: now };
        throw Object.assign(new Error('Concurrent review committed'), { code: 'P2002' });
      }
      const review = { ...data, reviewedAt: now }; state.reviews.push(review); state.row.attentionReview = review; return review;
    } },
    $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(db); },
  };
  const service = createClientAgentRunService({ recordAudit: async (_db, event) => { state.audits.push(event); return { id: 'audit' }; } });
  return { db, state, service, review: (user = actor) => service.review(db, user, client.id, conversation.id, 'run') };
}

test('review is durable, source-owned, audited once and idempotent without changing outcome or input', async () => {
  const f = fixture(); const before = { ...f.state.row };
  const first = await f.review(); const second = await f.review();
  assert.equal(first.status, 'UNKNOWN'); assert.equal(first.attentionReviewedAt, now);
  assert.equal(second.attentionReviewedAt.getTime(), now.getTime());
  assert.equal(f.state.reviews.length, 1); assert.equal(f.state.audits.length, 1);
  assert.equal(f.state.audits[0].action, 'client_agent_run.reviewed');
  for (const key of ['status', 'prompt', 'response', 'errorCode', 'requestedById']) assert.equal(f.state.row[key], before[key]);
  assert.equal('attentionReview' in first, false); assert.equal('organizationId' in first, false);
  assert.equal((await f.service.read(f.db, actor, client.id, conversation.id, 'run')).attentionReviewedAt.getTime(), now.getTime());
});

test('concurrent unique insert converges to the first stored review without replaying effects', async () => {
  const f = fixture({ collisions: 1 }); const result = await f.review();
  assert.equal(result.attentionReviewedAt.getTime(), now.getTime()); assert.equal(result.status, 'UNKNOWN');
  assert.equal(f.state.reviews.length, 0); assert.equal(f.state.audits.length, 0);
});

test('real closed-catalog audit writer accepts the review and stores only source identifiers', async () => {
  const f = fixture();const writes = [];
  f.db.auditEvent = { create: async ({ data }) => { writes.push(data);return { id: 'real-audit', ...data }; } };
  const actualService = createClientAgentRunService();
  const result = await actualService.review(f.db, actor, client.id, conversation.id, 'run');
  assert.equal(result.status, 'UNKNOWN');assert.equal(result.attentionReviewedAt, now);
  assert.equal(writes.length, 1);assert.equal(writes[0].action, 'client_agent_run.reviewed');
  assert.equal(writes[0].entityType, 'client_agent_run');assert.equal(writes[0].actorUserId, actor.id);
  assert.deepEqual(writes[0].metadata, { clientId: client.id, conversationId: conversation.id, runId: 'run' });
  assert.doesNotMatch(JSON.stringify(writes), /PRIVATE|Private prompt|provider|response/);
  await actualService.review(f.db, actor, client.id, conversation.id, 'run');assert.equal(writes.length, 1);
});

test('only current staff requester and matching tenant/client/conversation can acknowledge', async () => {
  for (const change of [
    f => { f.state.actor.role = 'CLIENT'; }, f => { f.state.actor.isActive = false; },
    f => { f.state.actor.organizationId = 'foreign'; }, f => { f.state.client.deletedAt = now; },
    f => { f.state.conversation.organizationId = 'foreign'; }, f => { f.state.row.conversationId = 'foreign'; },
    f => { f.state.row.requestedById = 'another'; }, f => { f.state.row.organizationId = 'foreign'; },
    f => { f.state.conversation.sourceChannelId = 'broken-source'; },
  ]) {
    const f = fixture(); change(f); await assert.rejects(f.review()); assert.equal(f.state.reviews.length, 0); assert.equal(f.state.audits.length, 0);
  }
  const f = fixture();f.state.actor.role = 'ADMIN';f.state.row.requestedById = 'another';
  await assert.rejects(f.review({ ...actor, role: 'ADMIN' }), { code: 'RECORD_NOT_FOUND' });
});

test('only FAILED/UNKNOWN can be reviewed; neither success, cancellation nor active work is attention', async () => {
  for (const status of ['QUEUED', 'RUNNING', 'SUCCEEDED', 'CANCELLED']) {
    const f = fixture();f.state.row.status = status;await assert.rejects(f.review(), { code: 'RUN_NOT_REVIEWABLE' });assert.equal(f.state.reviews.length, 0);
  }
  const f = fixture();f.state.row.status = 'FAILED';assert.equal((await f.review()).status, 'FAILED');
});

const item = index => ({ id: `run-${index}`, conversationId: 'conversation', requestedById: actor.id,
  status: index % 2 ? 'FAILED' : 'UNKNOWN', createdAt: now, clientId: 'client', clientName: 'Client', projectId: 'project', projectName: 'Project' });
function queueFixture(items) {
  const calls = [];return { calls, db: { user: { findFirst: async () => actor }, $queryRaw: async sql => { calls.push(sql);return items; } } };
}

test('queue uses own minimum summaries, exact transcript link and safe UNKNOWN instructions for both owner modes', async () => {
  const f = queueFixture([item(0)]);
  const options = { user: actor, now, sources: [source], filters: { owner: 'everyone', clientId: 'client', projectId: 'project' } };
  const q = await buildWorkQueue(f.db, options); const row = q.rows[0];
  assert.equal(row.type, 'agent_run');assert.equal(row.view, 'needs_action');assert.equal(row.state, 'UNKNOWN');
  assert.equal(row.sourceUrl, '/client/client?conversationId=conversation&runId=run-0');
  assert.match(row.nextAction, /possible provider cost/);assert.equal(row.owner.id, actor.id);
  assert.deepEqual((await buildWorkQueue(f.db, { ...options, filters: { ...options.filters, owner: 'me' } })).rows, q.rows);
  const sql = f.calls[0];assert.deepEqual(JSON.parse(sql.values[0]), { organizationId: 'org', actorId: 'staff', clientId: 'client', projectId: 'project' });assert.equal(sql.values[1], 101);
  assert.match(sql.text, /r\.status IN \('FAILED','UNKNOWN'\)/);assert.match(sql.text, /review\."runId" IS NULL/);
  assert.match(sql.text, /cm\."leftAt" IS NULL/);assert.match(sql.text, /u\."isActive" AND u\.role/);
  assert.match(sql.text, /b\."projectId" IS NOT DISTINCT FROM ch\."projectId"/);
  assert.ok(sql.text.indexOf("args.x->>'projectId'") < sql.text.indexOf('LIMIT'));
  assert.doesNotMatch(sql.text.split('FROM')[0], /prompt|response|errorCode|cv\.title|ch\.name/);
});

test('cap101/truncation, date exclusion and source failure remain honest without suppressing other sources', async () => {
  const f = queueFixture(Array.from({ length: 101 }, (_, i) => item(i)));
  const q = await buildWorkQueue(f.db, { user: actor, now, sources: [source] });
  assert.equal(q.total, 100);assert.equal(q.counts.needs_action, 100);assert.deepEqual(q.truncatedSources, ['agent_runs']);
  const exact = await buildWorkQueue(queueFixture(Array.from({ length: 100 }, (_, i) => item(i))).db, { user: actor, now, sources: [source] });assert.deepEqual(exact.truncatedSources, []);
  const dated = await buildWorkQueue(f.db, { user: actor, now, sources: [source], filters: { dueFrom: '2026-10-01' } });assert.equal(dated.total, 0);assert.deepEqual(dated.sources, []);
  f.db.$queryRaw = async () => { throw Error('PRIVATE PROMPT'); };
  const failed = await buildWorkQueue(f.db, { user: actor, now, sources: [source, { key: 'other', load: async () => [{ ...q.rows[0], id: 'other' }] }] });
  assert.equal(failed.partial, true);assert.deepEqual(failed.failedSources, ['agent_runs']);assert.equal(failed.total, 1);assert.doesNotMatch(JSON.stringify(failed), /PRIVATE PROMPT/);
});

test('stored demotion/deactivation and invalid bounds fail before raw SQL', async () => {
  for (const current of [null, { ...actor, role: 'CLIENT' }, { ...actor, role: 'BOT' }, { ...actor, isActive: false }]) {
    let reads = 0;const db = { user: { findFirst: async () => current }, $queryRaw: async () => { reads++;return []; } };
    await assert.rejects(listClientAgentRunAttentionForQueue(db, actor), { code: 'ROLE_DENIED' });assert.equal(reads, 0);
  }
  for (const limit of [0, 102, 1.2]) await assert.rejects(listClientAgentRunAttentionForQueue({}, actor, { limit }), { code: 'INVALID_INPUT' });
});

test('review delegate is directly tenant scoped and append-only, including nested proxies', async () => {
  const calls = [];
  const raw = { clientAgentRunReview: {
    findMany: async args => { calls.push(args);return []; },
    update: async () => { throw Error('must not mutate'); },
    delete: async () => { throw Error('must not mutate'); },
  } };
  const scoped = createScopedPrisma(createScopedPrisma(raw, actor.organizationId), actor.organizationId);
  await scoped.clientAgentRunReview.findMany({ where: { organizationId: 'foreign' } });
  assert.equal(calls[0].where.organizationId, actor.organizationId);
  for (const method of ['update', 'delete']) await assert.rejects(scoped.clientAgentRunReview[method]({ where: { runId: 'run' }, data: {} }), /append.only/i);
  assert.equal(calls.length, 1);
});
