// Operator queue (#461): row mapping, view assignment, role filtering and the
// partial-result contract, without a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ageInDays,
  buildWorkQueue,
  classifyReviewSession,
  classifyTask,
  compareRows,
  countByView,
  mapApprovalRow,
  mapContractRow,
  mapInvoiceRow,
  mapProposalRow,
  mapReviewRow,
  mapTaskRow,
  sourcesForRole,
  WORK_QUEUE_SOURCE_LIMIT,
  WORK_QUEUE_SOURCES,
  WORK_QUEUE_VIEWS,
} from '../../services/work-queue.service.js';
import { workQueueQuerySchema } from '../../routes/work-queue.routes.js';

const NOW = new Date('2026-09-30T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY);
const inDays = (n) => new Date(NOW.getTime() + n * DAY);
const project = { id: 'p1', name: 'Site', client: { id: 'c1', name: 'Acme' } };
const ROW_KEYS = ['type', 'id', 'title', 'sourceUrl', 'client', 'project', 'owner', 'state', 'nextAction', 'dueAt', 'ageDays', 'view'];

test('ageInDays counts whole days, never negative, and tolerates missing dates', () => {
  assert.equal(ageInDays(daysAgo(3), NOW), 3);
  assert.equal(ageInDays(new Date(NOW.getTime() - DAY + 1), NOW), 0);
  assert.equal(ageInDays(inDays(2), NOW), 0);
  assert.equal(ageInDays(null, NOW), null);
  assert.equal(ageInDays('not a date', NOW), null);
});

test('classifyTask: blocked and overdue are at risk; waiting-client waits; the rest needs action', () => {
  assert.deepEqual(classifyTask({ status: 'BLOCKED', blockedBy: 'DNS access', assigneeId: 'u1' }, NOW), {
    view: 'at_risk', state: 'BLOCKED', nextAction: 'Resolve blocker: DNS access',
  });
  assert.equal(classifyTask({ status: 'BLOCKED' }, NOW).nextAction, 'Resolve the blocker or reassign');
  assert.deepEqual(classifyTask({ status: 'PENDING', dueDate: daysAgo(1), assigneeId: 'u1' }, NOW).state, 'OVERDUE');
  assert.equal(classifyTask({ status: 'PENDING', dueDate: daysAgo(1), category: 'WAITING_CLIENT' }, NOW).view, 'at_risk',
    'an overdue task is at risk even while waiting on the client');
  assert.equal(classifyTask({ status: 'PENDING', category: 'WAITING_CLIENT', assigneeId: 'u1' }, NOW).view, 'waiting_on_client');
  assert.deepEqual(classifyTask({ status: 'IN_PROGRESS', assigneeId: 'u1', dueDate: inDays(1) }, NOW), {
    view: 'needs_action', state: 'IN_PROGRESS', nextAction: 'Finish and mark complete',
  });
  assert.equal(classifyTask({ status: 'PENDING', assigneeId: 'u1' }, NOW).nextAction, 'Start the task');
  assert.equal(classifyTask({ status: 'PENDING' }, NOW).nextAction, 'Assign an owner');
});

test('mapTaskRow produces the canonical row with its source link and owner', () => {
  const row = mapTaskRow({
    id: 't1', title: 'Write copy', status: 'PENDING', dueDate: inDays(2), createdAt: daysAgo(4),
    assigneeId: 'u1', assignee: { id: 'u1', name: 'Tom' }, project,
  }, NOW);
  assert.deepEqual(Object.keys(row).sort(), [...ROW_KEYS].sort());
  assert.deepEqual(row, {
    type: 'task', id: 't1', title: 'Write copy', sourceUrl: '/task/t1',
    client: { id: 'c1', name: 'Acme' }, project: { id: 'p1', name: 'Site' },
    owner: { id: 'u1', name: 'Tom', role: null }, state: 'PENDING', nextAction: 'Start the task',
    dueAt: inDays(2).toISOString(), ageDays: 4, view: 'needs_action',
  });
  // A removed assignee is still named as an owner id rather than dropped.
  const orphan = mapTaskRow({ id: 't2', title: 'x', status: 'PENDING', assigneeId: 'gone', createdAt: NOW }, NOW);
  assert.deepEqual(orphan.owner, { id: 'gone', name: 'Former team member', role: null });
  assert.equal(orphan.client, null);
  assert.equal(orphan.project, null);
});

test('approvals await an admin decision and fall back to the stored client name', () => {
  const row = mapApprovalRow({ id: 'a1', type: 'EMAIL', status: 'PENDING', title: 'Launch email', clientName: 'Acme Inc', createdAt: daysAgo(2) }, NOW);
  assert.equal(row.view, 'awaiting_approval');
  assert.equal(row.sourceUrl, '/approvals');
  assert.deepEqual(row.owner, { id: null, name: 'Admins', role: 'ADMIN' });
  assert.deepEqual(row.client, { id: null, name: 'Acme Inc' });
  assert.equal(row.nextAction, 'Approve or reject this email');
  assert.equal(row.ageDays, 2);
  const expired = mapApprovalRow({ id: 'a2', type: 'POST', status: 'PENDING', title: 'x', expiresAt: daysAgo(1), createdAt: daysAgo(5), project }, NOW);
  assert.equal(expired.view, 'awaiting_approval', 'an expired request stays pending until the approval workflow decides');
  assert.match(expired.nextAction, /expiry/);
  assert.deepEqual(expired.client, { id: 'c1', name: 'Acme' });
});

test('review sessions: changes requested need action, shared ones wait on the client, internal ones await approval', () => {
  assert.equal(classifyReviewSession({ status: 'changes_requested', sharedWithClient: true }).view, 'needs_action');
  assert.deepEqual(classifyReviewSession({ status: 'open', sharedWithClient: true, clientCanDecide: true }), {
    view: 'waiting_on_client', state: 'open', nextAction: 'Waiting on the client decision',
  });
  assert.equal(classifyReviewSession({ status: 'open', sharedWithClient: true }).nextAction, 'Waiting on client feedback');
  assert.equal(classifyReviewSession({ status: 'open', sharedWithClient: false }).view, 'awaiting_approval');
  const row = mapReviewRow({ id: 'r1', title: 'Logo v2', status: 'open', createdById: 'u1', createdAt: daysAgo(6), updatedAt: daysAgo(1), project },
    new Map([['u1', { id: 'u1', name: 'Ada' }]]), NOW);
  assert.equal(row.sourceUrl, '/review/r1');
  assert.equal(row.owner.name, 'Ada');
  assert.equal(row.ageDays, 1);
});

test('finance documents wait on the client, go at risk when late, and need action when delivery failed', () => {
  const base = { client: { id: 'c1', name: 'Acme' }, createdBy: { id: 'u1', name: 'Ada' }, createdById: 'u1', createdAt: daysAgo(10) };
  const proposal = mapProposalRow({ ...base, id: 'pr1', title: 'Retainer', status: 'SENT', validUntil: inDays(3), sentAt: daysAgo(2) }, NOW);
  assert.equal(proposal.view, 'waiting_on_client');
  assert.equal(proposal.sourceUrl, '/proposal/pr1');
  assert.equal(proposal.ageDays, 2, 'waiting since it was sent');
  assert.equal(mapProposalRow({ ...base, id: 'pr2', title: 'x', status: 'VIEWED', validUntil: daysAgo(1) }, NOW).view, 'at_risk');
  assert.equal(mapProposalRow({ ...base, id: 'pr3', title: 'x', status: 'SENT', deliveryStatus: 'BOUNCED', validUntil: daysAgo(1) }, NOW).view, 'needs_action');

  const contract = mapContractRow({ ...base, id: 'k1', title: 'MSA', status: 'SENT', proposal: { project: { id: 'p1', name: 'Site' } } }, NOW);
  assert.equal(contract.view, 'waiting_on_client');
  assert.equal(contract.sourceUrl, '/contracts');
  assert.deepEqual(contract.project, { id: 'p1', name: 'Site' });
  assert.equal(mapContractRow({ ...base, id: 'k2', title: 'x', status: 'SENT', deliveryStatus: 'failed' }, NOW).view, 'needs_action');

  const invoice = mapInvoiceRow({ ...base, id: 'i1', invoiceNumber: 'INV-1', status: 'SENT', dueDate: inDays(5), sentAt: daysAgo(1) }, NOW);
  assert.equal(invoice.view, 'waiting_on_client');
  assert.equal(invoice.title, 'Invoice INV-1');
  assert.equal(invoice.sourceUrl, '/invoices/i1');
  const late = mapInvoiceRow({ ...base, id: 'i2', invoiceNumber: 'INV-2', title: 'Sept', status: 'SENT', dueDate: daysAgo(1) }, NOW);
  assert.deepEqual([late.view, late.state, late.title], ['at_risk', 'OVERDUE', 'INV-2 · Sept']);
  assert.equal(mapInvoiceRow({ ...base, id: 'i3', invoiceNumber: 'INV-3', status: 'OVERDUE' }, NOW).view, 'at_risk');
});

test('rows sort by due date (undated last), then by age; counts cover every view', () => {
  const rows = [
    { id: 'undated-old', dueAt: null, ageDays: 9, view: 'needs_action' },
    { id: 'due-late', dueAt: inDays(5).toISOString(), ageDays: 1, view: 'at_risk' },
    { id: 'due-soon', dueAt: inDays(1).toISOString(), ageDays: 1, view: 'at_risk' },
    { id: 'undated-new', dueAt: null, ageDays: 1, view: 'waiting_on_client' },
  ].sort(compareRows);
  assert.deepEqual(rows.map((row) => row.id), ['due-soon', 'due-late', 'undated-old', 'undated-new']);
  assert.deepEqual(countByView(rows), { needs_action: 1, awaiting_approval: 0, waiting_on_client: 1, at_risk: 2 });
});

test('finance and approval sources are admin-only', () => {
  assert.deepEqual(sourcesForRole('ADMIN').map((source) => source.key), ['tasks', 'approvals', 'reviews', 'proposals', 'contracts', 'invoices']);
  for (const role of ['TEAM', 'STAFF']) {
    assert.deepEqual(sourcesForRole(role).map((source) => source.key), ['tasks', 'reviews']);
  }
  assert.ok(WORK_QUEUE_SOURCES.every((source) => typeof source.load === 'function'));
});

test('buildWorkQueue marks the response partial when a source fails and keeps the others', async () => {
  const sources = [
    { key: 'tasks', adminOnly: false, load: async () => [mapTaskRow({ id: 't1', title: 'x', status: 'BLOCKED', createdAt: NOW }, NOW)] },
    { key: 'invoices', adminOnly: true, load: async () => { throw new Error('database unavailable'); } },
  ];
  const result = await buildWorkQueue({}, { user: { id: 'u1', role: 'ADMIN' }, now: NOW, sources });
  assert.equal(result.partial, true);
  assert.deepEqual(result.failedSources, ['invoices']);
  assert.deepEqual(result.sources, ['tasks', 'invoices']);
  assert.equal(result.total, 1);
  assert.deepEqual(result.counts, { needs_action: 0, awaiting_approval: 0, waiting_on_client: 0, at_risk: 1 });
  assert.equal(result.generatedAt, NOW.toISOString());
});

test('buildWorkQueue filters rows by view, keeps every count, and reports truncated sources', async () => {
  const many = Array.from({ length: WORK_QUEUE_SOURCE_LIMIT }, (_, i) => mapTaskRow({ id: `t${i}`, title: 'x', status: 'PENDING', assigneeId: 'u1', createdAt: NOW }, NOW));
  const sources = [
    { key: 'tasks', adminOnly: false, load: async () => many },
    { key: 'reviews', adminOnly: false, load: async () => [mapReviewRow({ id: 'r1', title: 'x', status: 'open', createdAt: NOW }, new Map(), NOW)] },
  ];
  const result = await buildWorkQueue({}, { user: { id: 'u1', role: 'TEAM' }, filters: { view: 'awaiting_approval' }, now: NOW, sources });
  assert.equal(result.view, 'awaiting_approval');
  assert.deepEqual(result.rows.map((row) => row.id), ['r1']);
  assert.equal(result.counts.needs_action, WORK_QUEUE_SOURCE_LIMIT);
  assert.deepEqual(result.truncatedSources, ['tasks']);
  assert.equal(result.partial, false);
});

test('buildWorkQueue passes filters and the caller to each source it runs', async () => {
  const seen = [];
  const sources = [{ key: 'tasks', adminOnly: false, load: async (prisma, context) => { seen.push({ prisma, ...context }); return []; } }];
  const prisma = { marker: true };
  await buildWorkQueue(prisma, { user: { id: 'u1', role: 'TEAM' }, filters: { owner: 'me', clientId: 'c1' }, now: NOW, sources });
  assert.equal(seen[0].prisma, prisma);
  assert.deepEqual(seen[0].filters, { owner: 'me', clientId: 'c1' });
  assert.deepEqual(seen[0].user, { id: 'u1', role: 'TEAM' });
});

test('query schema accepts the four views and owner filters, and rejects anything else', () => {
  assert.deepEqual(workQueueQuerySchema.parse({}), { owner: 'everyone' });
  for (const view of WORK_QUEUE_VIEWS) assert.equal(workQueueQuerySchema.parse({ view }).view, view);
  assert.equal(workQueueQuerySchema.parse({ owner: 'me', clientId: 'c1', projectId: 'p1' }).owner, 'me');
  assert.equal(workQueueQuerySchema.safeParse({ view: 'all' }).success, false);
  assert.equal(workQueueQuerySchema.safeParse({ owner: 'someone' }).success, false);
  assert.equal(workQueueQuerySchema.safeParse({ limit: '5' }).success, false, 'unknown parameters are refused');
  assert.equal(workQueueQuerySchema.safeParse({ clientId: 'x'.repeat(51) }).success, false);
});
