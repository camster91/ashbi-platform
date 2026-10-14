const targets = { TASK: 'task', PROJECT: 'project', CLIENT: 'client', PERSON: 'user' };
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };

// Decorate only an authorized result page. Values retain their canonical ids;
// missing, deleted, inactive or foreign targets receive no name or link data.
export async function taskRelationLabels(prisma, projectId, fieldKey, tasks, actor) {
  if (!fieldKey) return tasks;
  if (!actor?.organizationId || !['ADMIN', 'TEAM'].includes(actor.role)) fail(403, 'Team access required');
  if (!projectId) fail(400, 'Choose a project for related-record labels.');
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId: actor.organizationId, deletedAt: null }, select: { taskFields: true } });
  if (!project) fail(404, 'Project not found');
  const field = (Array.isArray(project.taskFields) ? project.taskFields : []).find(item => item.key === fieldKey && item.type === 'RELATION' && !item.archived);
  const model = targets[field?.target];
  if (!model) fail(400, 'Choose an available relation field.');
  if (tasks.some(task => task.projectId !== projectId)) fail(403, 'Task scope mismatch');
  const ids = [...new Set(tasks.map(task => task.fieldValues?.[fieldKey]).filter(value => typeof value === 'string' && value.length > 0))];
  const labels = new Map();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const where = { id: { in: ids.slice(offset, offset + 100) }, ...(model === 'task' ? { deletedAt: null, project: { organizationId: actor.organizationId, deletedAt: null } } : { organizationId: actor.organizationId, ...(model === 'user' ? { isActive: true, role: { in: ['ADMIN', 'TEAM'] } } : { deletedAt: null }) }) };
    const rows = await prisma[model].findMany({ where, select: { id: true, ...(model === 'task' ? { title: true } : { name: true }) }, take: 100 });
    for (const row of rows) labels.set(row.id, { id: row.id, name: row.title ?? row.name });
  }
  return tasks.map(task => ({ ...task, fieldRelations: { ...(task.fieldRelations ?? {}), [fieldKey]: labels.get(task.fieldValues?.[fieldKey]) ?? null } }));
}
