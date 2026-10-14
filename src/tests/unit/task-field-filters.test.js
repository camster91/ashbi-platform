import test from 'node:test';
import assert from 'node:assert/strict';
import { taskViewFiltersSchema } from '../../validators/schemas.js';
import { taskViewWhere } from '../../shared/task-view-filters.js';
import { validateTaskFieldFilterDefinitions, validateTaskFieldFilters } from '../../services/task-field-filters.service.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const fields = ['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'URL', 'SELECT', 'MULTI_SELECT', 'RELATION'].map(type => ({ key: type.toLowerCase(), name: type, type, options: ['Design', 'Build'], target: type === 'RELATION' ? 'CLIENT' : undefined }));
test('all typed fields support valid criteria, preserving zero, false and array membership', () => {
  const filters = fields.map((field, index) => ({ key: field.key, operator: field.type === 'MULTI_SELECT' ? 'HAS' : 'EQ', value: ['Review', 0, false, '2028-02-29', 'https://example.test', 'Design', 'Build', 'client-a'][index] }));
  validateTaskFieldFilterDefinitions(fields, filters);
  const parsed = taskViewFiltersSchema.parse({ fieldFilters: JSON.stringify(filters), search: ' artwork ' });
  const where = taskViewWhere(parsed);
  assert.equal(where.AND[1].fieldValues.equals, 0);
  assert.equal(where.AND[2].fieldValues.equals, false);
  assert.deepEqual(where.AND[6].fieldValues.array_contains, ['Build']);
  assert.equal(where.OR[0].title.contains, 'artwork');
});
test('unknown, archived, wrong-type and invalid-date filters fail closed', () => {
  for (const filter of [
    { key: 'unknown', operator: 'EQ', value: 'x' }, { key: 'number', operator: 'EQ', value: '0' },
    { key: 'boolean', operator: 'GTE', value: true }, { key: 'date', operator: 'LTE', value: '2026-02-30' },
    { key: 'multi_select', operator: 'HAS', value: 'Unavailable' },
  ]) assert.throws(() => validateTaskFieldFilterDefinitions(fields, [filter]), { statusCode: 400 });
  assert.throws(() => validateTaskFieldFilterDefinitions([{ ...fields[0], archived: true }], [{ key: 'text', operator: 'EQ', value: 'x' }]), { statusCode: 400 });
  assert.equal(taskViewFiltersSchema.safeParse({ fieldFilters: '{invalid' }).success, false);
  assert.equal(taskViewFiltersSchema.safeParse({ fieldFilters: [{ key: '__proto__', operator: 'EQ', value: 'x' }] }).success, false);
  assert.equal(taskViewFiltersSchema.safeParse({ fieldFilters: Array(11).fill({ key: 'text', operator: 'EQ', value: 'x' }) }).success, false);
});
test('field criteria require an authorized project before reading tasks through MCP', async () => {
  let projectQuery, taskQuery;
  const ctx = { user: { id: 'staff', role: 'TEAM', organizationId: 'org-a' }, scopes: ['workspace:read'], prisma: {
    project: { findFirst: async query => { projectQuery = query; return query.where.id === 'allowed' ? { taskFields: fields } : null; } },
    task: { findMany: async query => { taskQuery = query; return []; } },
  } };
  const criteria = [{ key: 'number', operator: 'GTE', value: 0 }];
  await assert.rejects(validateTaskFieldFilters(ctx.prisma, undefined, criteria), { statusCode: 400 });
  await assert.rejects(validateTaskFieldFilters(ctx.prisma, 'foreign', criteria, 'org-a'), { statusCode: 404 });
  const tools = createWorkspaceTools();
  await tools.call(ctx, 'list_tasks', { projectId: 'allowed', fieldFilters: criteria });
  assert.deepEqual(projectQuery.where, { id: 'allowed', organizationId: 'org-a' });
  assert.equal(taskQuery.where.project.organizationId, 'org-a');
  assert.equal(taskQuery.where.AND[0].fieldValues.gte, 0);
  taskQuery = undefined;
  await assert.rejects(tools.call(ctx, 'list_tasks', { projectId: 'foreign', fieldFilters: criteria }));
  assert.equal(taskQuery, undefined);
});
