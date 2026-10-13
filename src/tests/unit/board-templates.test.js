import test from 'node:test';
import assert from 'node:assert/strict';
import { saveBoardTemplate, projectFromBoardTemplate, archiveBoardTemplate, listBoardTemplates, validateBoardConfig } from '../../services/board-templates.service.js';
import { boardTemplateProjectSchema } from '../../validators/schemas.js';
import projectRoutes from '../../routes/project.routes.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const config = { version: 1, stages: [{ key: 'review', name: 'Client review', status: 'REVIEW' }], fields: [{ key: 'brief', name: 'Brief', type: 'TEXT', archived: false }], views: [{ key: 'table', name: 'Table', layout: 'TABLE', sort: 'TITLE', filters: {}, columns: ['brief'] }] };
function fixture() {
  const created = [], templates = [];
  const template = { id: 'template', kind: 'BOARD', boardConfig: config };
  const prisma = { project: {
    findFirst: async ({ where }) => where.id === 'source' ? { id: 'source', taskStages: config.stages, taskFields: config.fields, taskViews: config.views, tasks: [{ title: 'Private source task' }], budget: 1000 } : null,
    create: async ({ data }) => { created.push(data); return { id: 'new', ...data }; },
  }, client: { findFirst: async ({ where }) => where.id === 'client' ? { id: 'client' } : null }, projectTemplate: {
    create: async ({ data }) => { templates.push(data); return { id: 'template', ...data }; },
    findFirst: async ({ where }) => where.id === 'template' && (typeof where.kind === 'string' ? where.kind === template.kind : where.kind.in.includes(template.kind)) ? template : null,
    update: async ({ data }) => Object.assign(template, data), findMany: async () => [template],
  } };
  prisma.$transaction = async (work, options) => { assert.equal(options.isolationLevel, 'Serializable'); return work(prisma); };
  return { prisma, created, templates };
}
test('board snapshots and empty projects retain workflow metadata without copying source business records', async () => {
  const { prisma, created, templates } = fixture();
  await saveBoardTemplate(prisma, { projectId: 'source', name: 'Design delivery' });
  assert.deepEqual(templates[0].boardConfig, config);
  assert.deepEqual(Object.keys(templates[0]).sort(), ['boardConfig', 'description', 'kind', 'name']);
  await projectFromBoardTemplate(prisma, { templateId: 'template', clientId: 'client', name: 'New project', portfolio: 'FREELANCE' });
  assert.deepEqual(created[0], { name: 'New project', clientId: 'client', portfolio: 'FREELANCE', taskStages: config.stages, taskViews: config.views, taskFields: config.fields });
});
test('missing/foreign sources, clients and templates do not create projects', async () => {
  const { prisma, created } = fixture();
  await assert.rejects(saveBoardTemplate(prisma, { projectId: 'foreign', name: 'Board' }), { statusCode: 404 });
  await assert.rejects(projectFromBoardTemplate(prisma, { templateId: 'foreign', clientId: 'client', name: 'New' }), { statusCode: 404 });
  await assert.rejects(projectFromBoardTemplate(prisma, { templateId: 'template', clientId: 'foreign', name: 'New' }), { statusCode: 404 });
  assert.equal(created.length, 0);
});
test('archive blocks new use; restoration retains all template metadata', async () => {
  const { prisma } = fixture();
  assert.equal((await archiveBoardTemplate(prisma, 'template', true)).kind, 'BOARD_ARCHIVED');
  await assert.rejects(projectFromBoardTemplate(prisma, { templateId: 'template', clientId: 'client', name: 'New' }), { statusCode: 404 });
  const restored = await archiveBoardTemplate(prisma, 'template', false);
  assert.deepEqual(restored.boardConfig, config);
  assert.equal(restored.kind, 'BOARD');
});
test('defaults and valid metadata are accepted, but broken references and invalid portfolios fail', () => {
  validateBoardConfig(config);
  validateBoardConfig({ version: 1, stages: [], fields: [], views: [] });
  assert.throws(() => validateBoardConfig({ ...config, version: 2 }), { statusCode: 400 });
  assert.throws(() => validateBoardConfig({ ...config, fields: [] }), { statusCode: 400 });
  assert.equal(boardTemplateProjectSchema.safeParse({ templateId: 't', clientId: 'c', name: 'New', portfolio: 'PRIVATE' }).success, false);
});
test('board list bounds pages, cursor and archive inclusion', async () => {
  const { prisma } = fixture();
  let query;
  prisma.projectTemplate.findMany = async args => { query = args; return Array.from({ length: 26 }, (_, index) => ({ id: String(index) })); };
  const page = await listBoardTemplates(prisma, true, 'cursor');
  assert.equal(query.take, 26);
  assert.deepEqual(query.where, { kind: { in: ['BOARD', 'BOARD_ARCHIVED'] }, id: { gt: 'cursor' } });
  assert.equal(page.items.length, 25);
  assert.equal(page.nextCursor, '24');
});
test('legacy project-template routes cannot consume or delete board snapshots', async () => {
  const handlers = {};
  const noop = () => {};
  const register = method => (path, _options, handler) => { handlers[`${method} ${path}`] = handler; };
  const prisma = { projectTemplate: { findUnique: async () => ({ id: 'board', kind: 'BOARD' }),
    delete: async ({ where }) => { assert.equal(where.kind, 'PROJECT'); throw Object.assign(new Error('Missing legacy template'), { code: 'P2025' }); } } };
  await projectRoutes({ authenticate: noop, prisma, get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE') });
  const reply = { status: code => { assert.equal(code, 404); return reply; }, send: body => body };
  assert.equal((await handlers['POST /from-template']({ body: { templateId: 'board', clientId: 'client', name: 'New' } }, reply)).error, 'Template not found');
  assert.equal((await handlers['DELETE /templates/:templateId']({ params: { templateId: 'board' } }, reply)).error, 'Template not found');
});
test('workspace/MCP template reads keep explicit tenant and archive scope', async () => {
  let query;
  const context = { user: { id: 'u1', role: 'TEAM', organizationId: 'org-a' }, scopes: ['workspace:read'], prisma: { projectTemplate: { findMany: async args => { query = args; return []; } } } };
  await createWorkspaceTools().call(context, 'list_board_templates', { includeArchived: true, after: 'cursor', limit: 10 });
  assert.deepEqual(query.where, { organizationId: 'org-a', kind: { in: ['BOARD', 'BOARD_ARCHIVED'] }, id: { gt: 'cursor' } });
  assert.equal(query.take, 11);
});
