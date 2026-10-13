import { withStageTransaction } from './task-stages.service.js';

const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const models = { TASK: 'task', PROJECT: 'project', CLIENT: 'client', PERSON: 'user' };
export async function readTaskFieldDefinitions(prisma, projectId) {
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { id: true, name: true, taskFields: true, taskFieldsRevision: true } });
  if (!project) fail(404, 'Project not found');
  return { projectId: project.id, projectName: project.name, fields: project.taskFields ?? [], revision: project.taskFieldsRevision };
}
export async function saveTaskFieldDefinitions(prisma, projectId, { revision, fields }) {
  return withStageTransaction(prisma, async tx => {
    const current = await readTaskFieldDefinitions(tx, projectId);
    if (revision !== current.revision) fail(409, 'Field definitions changed. Reload before saving.');
    for (const old of current.fields) {
      const next = fields.find(field => field.key === old.key);
      if (!next) fail(400, 'Archive fields instead of deleting them; existing values must be retained.');
      if (next.type !== old.type || next.target !== old.target) fail(400, 'Existing field types cannot change. Archive the field and add a new one.');
      if ((old.options ?? []).some(option => !next.options?.includes(option))) fail(400, 'Existing choices must be retained. Add choices or archive the field.');
    }
    await tx.project.update({ where: { id: projectId }, data: { taskFields: fields, taskFieldsRevision: { increment: 1 } } });
    return { ...current, fields, revision: revision + 1 };
  }, 'Field definitions changed while saving. Reload and try again.');
}
export function validateFieldValue(field, value) {
  if (value === null) return;
  let valid = false;
  switch (field.type) {
    case 'TEXT': valid = typeof value === 'string' && value.length <= 2000; break;
    case 'NUMBER': valid = typeof value === 'number' && Number.isFinite(value); break;
    case 'BOOLEAN': valid = typeof value === 'boolean'; break;
    case 'DATE': valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; break;
    case 'URL': {
      if (typeof value === 'string' && value.length <= 2048) {
        try { const url = new URL(value); valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { /* Invalid URL. */ }
      }
      break;
    }
    case 'SELECT': valid = typeof value === 'string' && field.options.includes(value); break;
    case 'MULTI_SELECT': valid = Array.isArray(value) && value.length <= 30 && value.every(item => typeof item === 'string' && field.options.includes(item)) && new Set(value).size === value.length; break;
    case 'RELATION': valid = typeof value === 'string' && value.length > 0 && value.length <= 80; break;
  }
  if (!valid) fail(400, `Invalid value for ${field.name}.`);
}
async function reference(prisma, field, id) {
  const model = models[field.target];
  return prisma[model].findFirst({ where: { id, ...(model === 'user' ? { isActive: true, role: { in: ['ADMIN', 'TEAM'] } } : {}) }, select: { id: true, ...(model === 'task' ? { title: true } : { name: true }) } });
}
export async function readTaskFields(prisma, taskId) {
  const task = await prisma.task.findFirst({ where: { id: taskId }, select: { id: true, projectId: true, fieldValues: true, fieldValuesRevision: true } });
  if (!task) fail(404, 'Task not found');
  const definitions = await readTaskFieldDefinitions(prisma, task.projectId);
  const values = task.fieldValues ?? {};
  const relations = {};
  for (const field of definitions.fields.filter(item => item.type === 'RELATION' && !item.archived && values[item.key])) {
    const row = await reference(prisma, field, values[field.key]);
    relations[field.key] = row ? { id: row.id, name: row.title ?? row.name } : null;
  }
  return { taskId: task.id, ...definitions, definitionRevision: definitions.revision, revision: task.fieldValuesRevision, values, relations };
}
export async function saveTaskFieldValues(prisma, taskId, { revision, definitionRevision, values }) {
  return withStageTransaction(prisma, async tx => {
    const current = await readTaskFields(tx, taskId);
    if (revision !== current.revision || definitionRevision !== current.definitionRevision) fail(409, 'Fields changed. Reload before saving.');
    const next = { ...current.values };
    for (const [key, value] of Object.entries(values)) {
      const field = current.fields.find(item => item.key === key && !item.archived);
      if (!field) fail(400, 'Unknown or archived field. Reload field definitions.');
      validateFieldValue(field, value);
      if (field.type === 'RELATION' && value !== null && !await reference(tx, field, value)) fail(404, 'Related record is unavailable in this workspace.');
      // Clearing a broken relation remains possible; unrelated edits preserve it.
      next[key] = value;
    }
    await tx.task.update({ where: { id: taskId }, data: { fieldValues: next, fieldValuesRevision: { increment: 1 } } });
    return readTaskFields(tx, taskId);
  }, 'Fields changed while saving. Reload and try again.');
}
export async function taskFieldOptions(prisma, taskId, fieldKey, search = '') {
  const current = await readTaskFields(prisma, taskId);
  const field = current.fields.find(item => item.key === fieldKey && item.type === 'RELATION' && !item.archived);
  if (!field) fail(404, 'Relation field not found');
  const model = models[field.target];
  const label = model === 'task' ? 'title' : 'name';
  const rows = await prisma[model].findMany({ where: { [label]: { contains: search, mode: 'insensitive' }, ...(model === 'user' ? { isActive: true, role: { in: ['ADMIN', 'TEAM'] } } : {}) }, select: { id: true, [label]: true }, orderBy: [{ [label]: 'asc' }, { id: 'asc' }], take: 25 });
  return { items: rows.map(row => ({ id: row.id, name: row[label] })), limit: 25 };
}
