import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';

function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  for (const user of db.tables.user) user.isActive = true;
  for (const task of db.tables.task) Object.assign(task, { collaboratorsRevision: 0, recurrenceRevision: 0, recurrenceRule: {} });
  const transaction = db.$transaction;
  let transactions = 0;
  db.$transaction = async (work, options) => { transactions++; assert.equal(options.isolationLevel, 'Serializable'); return transaction(work); };
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(user => user.id === 'team-a')), scopes: ['workspace:read', 'workspace:actions'] };
  return { db, ctx, tools: createWorkspaceTools(), transactions: () => transactions };
}
const roster = { taskId: 'task-a', projectId: 'project-a', revision: 0, userIds: ['team2-a'] };
const recurrence = { taskId: 'task-a', projectId: 'project-a', revision: 0, rule: { trigger: 'AFTER_COMPLETION', frequency: 'WEEKLY', interval: 1, startDate: '2026-10-14', timeZone: 'America/Toronto' } };
test('contributor action previews names, mutates only on confirmation and confirms idempotently in one transaction', async () => {
  const { db, ctx, tools, transactions } = fixture();
  const prepared = await tools.call(ctx, 'set_task_collaborators', { input: roster, idempotencyKey: 'roster-action-1' });
  assert.equal(db.tables.taskCollaborator.length, 0); assert.equal(transactions(), 0);
  assert.equal(prepared.action.preview.after[0].name, 'Second A');
  const result = await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id });
  assert.equal(result.action.status, 'EXECUTED'); assert.equal(transactions(), 1);
  assert.equal(db.tables.task[0].assigneeId, 'team-a'); assert.equal(db.tables.task[0].collaboratorsRevision, 1);
  assert.equal(db.tables.taskCollaborator[0].userId, 'team2-a');
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
  assert.equal(db.tables.taskCollaborator.length, 1);
  assert.equal(db.tables.aiBridgeAction[0].approvalEvidence.method, 'api_key_confirm');
  assert.ok(db.tables.auditEvent.some(row => row.action === 'ai.tool_executed'));
});
test('recurrence preview is exact and confirmation uses the API service without nesting a transaction', async () => {
  const { db, ctx, tools, transactions } = fixture();
  const prepared = await tools.call(ctx, 'set_task_recurrence', { input: recurrence, idempotencyKey: 'recurrence-action-1' });
  assert.deepEqual(db.tables.task[0].recurrenceRule, {});
  assert.deepEqual(prepared.action.preview.after, recurrence.rule);
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
  assert.equal(transactions(), 1); assert.equal(db.tables.task[0].recurrenceRevision, 1);
  assert.deepEqual(db.tables.task[0].recurrenceRule, recurrence.rule);
  assert.equal(db.tables.task[0].recurrenceNextDate, null);
});
test('read-only keys, foreign tasks, unavailable staff and nonowners cannot prepare roster writes', async () => {
  const { ctx, tools } = fixture();
  await assert.rejects(tools.call({ ...ctx, scopes: ['workspace:read'] }, 'set_task_collaborators', {}), { code: 'TOOL_UNAVAILABLE' });
  for (const input of [{ ...roster, taskId: 'task-b', projectId: 'project-b' }, { ...roster, userIds: ['team-b'] }]) await assert.rejects(tools.call(ctx, 'set_task_collaborators', { input, idempotencyKey: 'forbidden-roster-1' }), { code: 'RECORD_NOT_FOUND' });
  await assert.rejects(tools.call({ ...ctx, user: { ...ctx.user, id: 'team2-a' } }, 'set_task_collaborators', { input: roster, idempotencyKey: 'nonowner-roster-1' }), { code: 'FORBIDDEN' });
});
test('stale previews, moved tasks and deactivated requesters fail atomically at confirmation', async () => {
  for (const change of [db => { db.tables.task[0].collaboratorsRevision = 1; }, db => { db.tables.task[0].projectId = 'project-b'; }, db => { db.tables.task[0].assigneeId = 'team2-a'; }, db => { db.tables.user.find(user => user.id === 'team-a').isActive = false; }, db => { db.tables.user.find(user => user.id === 'team-a').role = 'CLIENT'; }, db => { db.tables.user.find(user => user.id === 'team2-a').isActive = false; }]) {
    const { db, ctx, tools } = fixture();
    const prepared = await tools.call(ctx, 'set_task_collaborators', { input: roster, idempotencyKey: 'changed-roster-1' });
    change(db);
    await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: prepared.action.id }), { code: 'EXECUTION_FAILED' });
    assert.equal(db.tables.taskCollaborator.length, 0);
    assert.equal(db.tables.aiBridgeAction[0].status, 'FAILED');
  }
});

test('board action previews the destination, requires confirmation and refuses a stale membership', async () => {
  const { db, ctx, tools, transactions } = fixture();
  const projectId = 'cabcdefghijklmnopqrstuvwx';
  const boardId = 'cabcdefghijklmnopqrstuvwy';
  db.tables.project[0].id = projectId;
  Object.assign(db.tables.task[0], { projectId, boardId: null, boardMembershipRevision: 0 });
  db.tables.projectBoard.push({ id: boardId, projectId, organizationId: 'org-a', name: 'Delivery', archivedAt: null, taskStages: [{ key: 'review', name: 'Review', status: 'IN_PROGRESS' }] });
  const input = { taskId: 'task-a', projectId, boardId, revision: 0, stageKey: 'review' };
  const prepared = await tools.call(ctx, 'set_task_board', { input, idempotencyKey: 'board-action-1' });
  assert.equal(prepared.action.preview.afterBoard.name, 'Delivery');
  assert.equal(prepared.action.preview.afterStage.status, 'IN_PROGRESS');
  assert.equal(db.tables.task[0].boardId, null); assert.equal(transactions(), 0);
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).action.status, 'EXECUTED');
  assert.equal(db.tables.task[0].boardId, boardId); assert.equal(db.tables.task[0].assigneeId, 'team-a');
  assert.equal(db.tables.task[0].boardMembershipRevision, 1); assert.equal(transactions(), 1);
  assert.equal((await tools.call(ctx, 'confirm_action', { actionId: prepared.action.id })).idempotent, true);
  const stale = await tools.call(ctx, 'set_task_board', { input: { ...input, boardId: null, revision: 1, stageKey: undefined }, idempotencyKey: 'board-action-2' });
  db.tables.task[0].boardMembershipRevision = 2;
  await assert.rejects(tools.call(ctx, 'confirm_action', { actionId: stale.action.id }), { code: 'EXECUTION_FAILED' });
  assert.equal(db.tables.task[0].boardId, boardId);
  await assert.rejects(tools.call(ctx, 'set_task_board', { input: { ...input, revision: 2, stageKey: 'missing' }, idempotencyKey: 'board-action-3' }));
  db.tables.projectBoard[0].archivedAt = new Date();
  await assert.rejects(tools.call(ctx, 'set_task_board', { input: { ...input, revision: 2 }, idempotencyKey: 'board-action-4' }));
});
