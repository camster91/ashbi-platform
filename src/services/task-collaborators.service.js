import { withStageTransaction } from './task-stages.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
function assertStaff(actor) {
  if (!actor?.organizationId || !['ADMIN', 'TEAM'].includes(actor.role)) fail(403, 'Team access required');
}
export async function readTaskCollaborators(prisma, taskId, actor) {
  assertStaff(actor);
  const task = await prisma.task.findFirst({ where: { id: taskId, project: { organizationId: actor.organizationId } }, select: { id: true, assigneeId: true, collaboratorsRevision: true } });
  if (!task) fail(404, 'Task not found');
  const rows = await prisma.taskCollaborator.findMany({ where: { taskId, organizationId: actor.organizationId }, include: { user: { select: { id: true, name: true, isActive: true } } }, orderBy: { userId: 'asc' }, take: 30 });
  return { taskId, ownerId: task.assigneeId, revision: task.collaboratorsRevision, canManage: actor.role === 'ADMIN' || task.assigneeId === actor.id, collaborators: rows.map(row => row.user) };
}
export async function saveTaskCollaborators(prisma, taskId, { revision, userIds }, actor) {
  assertStaff(actor);
  if (!Array.isArray(userIds) || userIds.length > 30 || new Set(userIds).size !== userIds.length || userIds.some(id => typeof id !== 'string' || !id || id.length > 50)) fail(400, 'Choose up to 30 unique collaborators.');
  return withStageTransaction(prisma, async tx => {
    const current = await readTaskCollaborators(tx, taskId, actor);
    if (!current.canManage) fail(403, 'The task owner or an administrator manages collaborators.');
    if (revision !== current.revision) fail(409, 'Collaborators changed. Reload before saving.');
    const existing = new Set(current.collaborators.map(member => member.id));
    const additions = userIds.filter(id => !existing.has(id));
    const members = additions.length ? await tx.user.findMany({ where: { id: { in: additions }, organizationId: actor.organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true }, take: 30 }) : [];
    if (members.length !== additions.length) fail(404, 'A selected teammate is unavailable.');
    await tx.taskCollaborator.deleteMany({ where: { taskId, organizationId: actor.organizationId, userId: { notIn: userIds } } });
    if (members.length) await tx.taskCollaborator.createMany({ data: members.map(member => ({ taskId, userId: member.id, organizationId: actor.organizationId })) });
    await tx.task.update({ where: { id: taskId }, data: { collaboratorsRevision: { increment: 1 } } });
    return readTaskCollaborators(tx, taskId, actor);
  }, 'Collaborators changed while saving. Reload and try again.');
}
