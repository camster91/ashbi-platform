import test from 'node:test';
import assert from 'node:assert/strict';
import { readTeamWorkload, readTeamAllocations } from '../../services/team-workload.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const actor = { id: 'admin', organizationId: 'org-a', role: 'ADMIN' };
test('workload compares logged hours with weekly hours and retains contributors separately', async () => {
  const calls = [];
  const group = (model, rows) => ({ groupBy: async query => { calls.push({ model, query }); return rows; } });
  const prisma = {
    task: group('task', [{ assigneeId: 'one', _count: { _all: 123 } }]),
    taskCollaborator: group('collaborator', [{ userId: 'one', _count: { _all: 5 } }]),
    thread: group('thread', [{ assignedToId: 'one', _count: { _all: 3 } }]),
    timeEntry: group('time', [{ userId: 'one', _sum: { duration: 3000 } }, { userId: 'two', _sum: { duration: 60 } }]),
    user: { findMany: async ({ where, take }) => { assert.equal(where.organizationId, 'org-a'); assert.deepEqual(where.role.in, ['ADMIN', 'TEAM']); assert.equal(take, 100); return [{ id: 'one', name: 'One', role: 'TEAM', skills: '[]', capacity: 50 }, { id: 'two', name: 'Two', role: 'TEAM', skills: 'invalid', capacity: 0 }]; } },
  };
  const result = await readTeamWorkload(prisma, actor, new Date('2026-10-14T00:00:00Z'));
  const one = result.find(row => row.id === 'one');
  assert.equal(one.activeTasks, 123); assert.equal(one.contributedTasks, 5);
  assert.equal(one.weeklyHours, 50); assert.equal(one.weeklyCapacityHours, 20);
  assert.equal(one.utilizationPercent, 250); assert.equal(one.status, 'overloaded');
  const two = result.find(row => row.id === 'two');
  assert.equal(two.utilizationPercent, null); assert.equal(two.status, 'unconfigured'); assert.deepEqual(two.skills, []);
  for (const call of calls) assert.match(JSON.stringify(call.query.where), /org-a/);
  assert.equal(calls.find(call => call.model === 'time').query.where.date.lte.toISOString(), '2026-10-14T00:00:00.000Z');
  const tools = createWorkspaceTools();
  const context = { prisma, user: actor, scopes: ['workspace:read'] };
  const response = await tools.call(context, 'get_team_workload', {});
  assert.equal(response.output.find(row => row.id === 'one').activeTasks, 123);
  assert.ok(response.output.every(row => !('hourlyRate' in row)));
  await assert.rejects(tools.call({ ...context, scopes: [] }, 'get_team_workload', {}), { code: 'TOOL_UNAVAILABLE' });
});

test('project allocations aggregate full owned counts and bound canonical project label reads', async () => {
  const groups = Array.from({ length: 101 }, (_, index) => ({ assigneeId: 'one', projectId: `p${index}`, _count: { _all: 150 } }));
  const empty = { groupBy: async () => [] };
  const batches = [];
  const prisma = { task: { groupBy: async ({ by }) => by.length === 2 ? groups : [{ assigneeId: 'one', _count: { _all: 15150 } }] }, taskCollaborator: empty, thread: empty, timeEntry: empty,
    user: { findMany: async () => [{ id: 'one', name: 'One', capacity: 50, role: 'TEAM', skills: '[]' }] },
    project: { findMany: async ({ where, take }) => { assert.equal(where.organizationId, actor.organizationId); assert.equal(take, 100); batches.push(where.id.in.length); return where.id.in.map(id => ({ id, name: id })); } },
  };
  const result = await readTeamAllocations(prisma, actor);
  assert.deepEqual(batches, [100, 1]);
  assert.equal(result.allocations[0].projects.length, 101);
  assert.equal(result.allocations[0].projects[0].taskCount, 150);
  assert.equal(result.allocations[0].activeTasks, 15150);
  assert.equal(result.allocations[0].utilization, 0);
});

test('staff pagination passes the default 100-row cap and rejects client actors before reads', async () => {
  let pages = 0;
  const members = Array.from({ length: 101 }, (_, i) => ({ id: `u${String(i).padStart(3, '0')}`, name: 'Staff', capacity: 50, role: 'TEAM', skills: '[]' }));
  const empty = { groupBy: async () => [] };
  const prisma = { task: empty, taskCollaborator: empty, thread: empty, timeEntry: empty, user: { findMany: async ({ where, take }) => { pages++; return members.filter(member => !where.id || member.id > where.id.gt).slice(0, take); } } };
  assert.equal((await readTeamWorkload(prisma, actor)).length, 101); assert.equal(pages, 2);
  await assert.rejects(readTeamWorkload(prisma, { ...actor, role: 'CLIENT' }), { statusCode: 403 });
  assert.equal(pages, 2);
});
