import test from 'node:test';
import assert from 'node:assert/strict';
import { projectTaskFieldsSchema, taskFieldValuesSchema } from '../../validators/schemas.js';
import { readTaskFields, saveTaskFieldDefinitions, saveTaskFieldValues, validateFieldValue, taskFieldOptions } from '../../services/task-fields.service.js';

const fields = [{ key: 'brief', name: 'Brief', type: 'TEXT', archived: false }, { key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT', archived: false }];
function fixture() {
  const project = { id: 'p1', name: 'Project', taskFields: fields, taskFieldsRevision: 1 };
  const task = { id: 't1', projectId: 'p1', fieldValues: { brief: 'Original', legacy: 'Preserve' }, fieldValuesRevision: 2 };
  const writes = [];
  const prisma = { project: { findFirst: async ({ where }) => where.id === 'p1' ? project : null, update: async ({ data }) => { project.taskFields = data.taskFields; project.taskFieldsRevision++; } },
    task: { findFirst: async ({ where }) => where.id === 't1' ? task : null, update: async ({ data }) => { writes.push(data); task.fieldValues = data.fieldValues; task.fieldValuesRevision++; } },
    client: { findFirst: async ({ where }) => where.id === 'c1' ? { id: 'c1', name: 'Client' } : null, findMany: async () => [{ id: 'c1', name: 'Client' }] },
  };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, project, task, writes };
}
test('field schemas reject ambiguous types, choices, duplicate keys and unsafe property names', () => {
  assert.equal(projectTaskFieldsSchema.safeParse({ revision: 0, fields }).success, true);
  for (const invalid of [fields.concat(fields[0]), [{ ...fields[0], type: 'SELECT', options: [] }], [{ ...fields[0], options: ['Unexpected'] }], [{ ...fields[0], key: '__proto__' }], [{ ...fields[1], target: undefined }]]) {
    assert.equal(projectTaskFieldsSchema.safeParse({ revision: 0, fields: invalid }).success, false);
  }
  assert.equal(taskFieldValuesSchema.safeParse({ revision: 0, definitionRevision: 0, values: JSON.parse('{"__proto__": true}') }).success, false);
});
test('strict values reject impossible dates, executable URLs, coercions and unknown choices', () => {
  for (const [type, good, bad] of [['TEXT', 'Brief', 1], ['NUMBER', 0, '1'], ['BOOLEAN', false, 'false'], ['DATE', '2028-02-29', '2027-02-29'], ['URL', 'https://example.com', 'javascript:alert(1)'], ['SELECT', 'A', 'B'], ['MULTI_SELECT', ['A'], ['A', 'A']], ['RELATION', 'c1', {}]]) {
    const field = { name: 'Value', type, options: ['A'] };
    validateFieldValue(field, good); validateFieldValue(field, null);
    assert.throws(() => validateFieldValue(field, bad), { statusCode: 400 });
  }
  assert.throws(() => validateFieldValue({ type: 'URL', name: 'URL' }, 'https://user:password@example.com'), { statusCode: 400 });
});
test('field definitions retain archived data and reject stale/type/choice/deletion changes', async () => {
  const { prisma } = fixture();
  await assert.rejects(saveTaskFieldDefinitions(prisma, 'p1', { revision: 0, fields }), { statusCode: 409 });
  await assert.rejects(saveTaskFieldDefinitions(prisma, 'p1', { revision: 1, fields: [fields[0]] }), { statusCode: 400 });
  await assert.rejects(saveTaskFieldDefinitions(prisma, 'p1', { revision: 1, fields: [{ ...fields[0], type: 'NUMBER' }, fields[1]] }), { statusCode: 400 });
  const saved = await saveTaskFieldDefinitions(prisma, 'p1', { revision: 1, fields: fields.map(field => ({ ...field, archived: true })) });
  assert.equal(saved.revision, 2);
});
test('value patches preserve unrelated/archived values and never overwrite task content', async () => {
  const { prisma, writes } = fixture();
  const saved = await saveTaskFieldValues(prisma, 't1', { revision: 2, definitionRevision: 1, values: { brief: 'Updated', client: 'c1' } });
  assert.deepEqual(saved.values, { brief: 'Updated', legacy: 'Preserve', client: 'c1' });
  assert.deepEqual(Object.keys(writes[0]).sort(), ['fieldValues', 'fieldValuesRevision']);
  assert.equal((await readTaskFields(prisma, 't1')).relations.client.name, 'Client');
  assert.equal((await taskFieldOptions(prisma, 't1', 'client', 'Cli')).items[0].id, 'c1');
});
test('stale values/schema, unavailable relations, unknown/archived fields and foreign tasks fail closed', async () => {
  const { prisma, project, writes } = fixture();
  const body = { revision: 2, definitionRevision: 1, values: { client: 'foreign' } };
  await assert.rejects(saveTaskFieldValues(prisma, 't1', body), { statusCode: 404 });
  await assert.rejects(saveTaskFieldValues(prisma, 't1', { ...body, revision: 1 }), { statusCode: 409 });
  await assert.rejects(saveTaskFieldValues(prisma, 't1', { ...body, definitionRevision: 0 }), { statusCode: 409 });
  await assert.rejects(saveTaskFieldValues(prisma, 't1', { ...body, values: { unknown: 'x' } }), { statusCode: 400 });
  project.taskFields = fields.map(field => ({ ...field, archived: true }));
  await assert.rejects(saveTaskFieldValues(prisma, 't1', { ...body, values: { brief: 'x' } }), { statusCode: 400 });
  await assert.rejects(readTaskFields(prisma, 'foreign'), { statusCode: 404 });
  assert.equal(writes.length, 0);
});
