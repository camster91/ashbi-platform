import test from 'node:test';
import assert from 'node:assert/strict';
import { readTaskCollaborators, saveTaskCollaborators } from '../../services/task-collaborators.service.js';

const owner = { id: 'owner', organizationId: 'org-a', role: 'TEAM' };
function fixture() {
  const task = { id: 'task', assigneeId: 'owner', collaboratorsRevision: 0 };
  let members = [];
  const writes = [];
  const prisma = {
    task: { findFirst: async ({ where }) => where.project.organizationId === 'org-a' ? task : null, update: async ({ data }) => { writes.push(data); task.collaboratorsRevision++; } },
    taskCollaborator: { findMany: async () => members.map(id => ({ user: { id, name: id, isActive: true } })), deleteMany: async ({ where }) => { members = members.filter(id => where.userId.notIn.includes(id)); }, createMany: async ({ data }) => { members.push(...data.map(row => row.userId)); } },
    user: { findMany: async ({ where }) => {
      assert.equal(where.organizationId, owner.organizationId);
      assert.equal(where.isActive, true);
      assert.deepEqual(where.role.in, ['ADMIN', 'TEAM']);
      return where.id.in.filter(id => id === 'helper').map(id => ({ id }));
    } },
  };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, task, writes };
}
test('the owner adds collaborators without reassigning the accountable owner', async () => {
  const { prisma, task, writes } = fixture();
  const saved = await saveTaskCollaborators(prisma, 'task', { revision: 0, userIds: ['helper'] }, owner);
  assert.equal(saved.collaborators[0].id, 'helper');
  assert.equal(saved.revision, 1); assert.equal(task.assigneeId, 'owner');
  assert.deepEqual(writes, [{ collaboratorsRevision: { increment: 1 } }]);
  const retained = await saveTaskCollaborators(prisma, 'task', { revision: 1, userIds: ['helper'] }, owner);
  assert.equal(retained.collaborators.length, 1);
});
test('nonowners, stale revisions, foreign/inactive people and client principals cannot change membership', async () => {
  const { prisma, writes } = fixture();
  await assert.rejects(saveTaskCollaborators(prisma, 'task', { revision: 0, userIds: ['helper'] }, { ...owner, id: 'other' }), { statusCode: 403 });
  await assert.rejects(saveTaskCollaborators(prisma, 'task', { revision: 2, userIds: [] }, owner), { statusCode: 409 });
  await assert.rejects(saveTaskCollaborators(prisma, 'task', { revision: 0, userIds: ['foreign'] }, owner), { statusCode: 404 });
  await assert.rejects(readTaskCollaborators(prisma, 'task', { ...owner, organizationId: 'org-b' }), { statusCode: 404 });
  await assert.rejects(readTaskCollaborators(prisma, 'task', { ...owner, role: 'CLIENT' }), { statusCode: 403 });
  assert.equal(writes.length, 0);
});
