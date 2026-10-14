import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createWorkspaceCollection, updateWorkspaceCollection, createWorkspaceRecord, createWorkspaceRecordInTransaction, updateWorkspaceRecord, readWorkspaceRecord, createWorkspaceRecordForm, submitWorkspaceRecordForm, listWorkspaceRecordForms } from '../../services/workspace-records.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('standalone records/forms enforce PostgreSQL scope, revisions, complete rollups and atomic audit writes', { skip: !url && 'Disposable database is not configured', timeout: 150_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `records-${key}-${randomUUID()}`);
  const users = [], clients = [];
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Record fixture' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Record staff', password: randomUUID(), role: 'TEAM' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Canonical client' } }));
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    const fields = [{ key: 'hours', name: 'Hours', type: 'NUMBER', required: true }, { key: 'approved', name: 'Approved', type: 'BOOLEAN' }, { key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT' }];
    const source = await createWorkspaceCollection(scoped, { name: 'Work records', fields }, users[0]);
    const foreign = await createWorkspaceCollection(createScopedPrisma(raw, orgs[1]), { name: 'Foreign records', fields: [] }, users[1]);
    const a = await createWorkspaceRecord(scoped, source.id, { title: 'A', definitionRevision: 0, values: { hours: 0, approved: false, client: [clients[0].id] } }, users[0]);
    const b = await createWorkspaceRecord(scoped, source.id, { title: 'B', definitionRevision: 0, values: { hours: 5 } }, users[0]);
    for (const values of [{}, { hours: null }]) {
      await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[0].id, title: 'Missing required', values } }));
      await assert.rejects(raw.workspaceRecord.update({ where: { id: a.id }, data: { values } }));
    }
    assert.equal((await raw.workspaceRecord.findUnique({ where: { id: a.id } })).values.hours, 0);
    const requiredFields = [{ key: 'flag', name: 'Flag', type: 'BOOLEAN', required: true }, { key: 'brief', name: 'Brief', type: 'TEXT', required: true }, { key: 'choices', name: 'Choices', type: 'MULTI_SELECT', options: ['Ready'], required: true }];
    const required = await createWorkspaceCollection(scoped, { name: 'Required inputs', fields: requiredFields }, users[0]);
    for (const values of [{ flag: null, brief: 'Valid', choices: ['Ready'] }, { flag: false, brief: '\t\n ', choices: ['Ready'] }, { flag: false, brief: 'Valid', choices: [] }]) await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: required.id, authorId: users[0].id, title: 'Invalid required', values } }));
    const falsy = await raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: required.id, authorId: users[0].id, title: 'Valid false', values: { flag: false, brief: 'Valid', choices: ['Ready'] } } });
    assert.equal(falsy.values.flag, false);
    await assert.rejects(raw.workspaceCollection.update({ where: { id: source.id }, data: { fields: [...fields, { key: 'new_required', name: 'New required', type: 'TEXT', required: true }] } }));
    const archivedMissing = await raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[0].id, title: 'Archived history', archivedAt: new Date(), values: {} } });
    await assert.rejects(raw.workspaceRecord.update({ where: { id: archivedMissing.id }, data: { archivedAt: null } }));
    const tools = createWorkspaceTools(), ctx = { prisma: scoped, user: users[0], scopes: ['workspace:read', 'workspace:actions'] };
    const input = { collectionId: source.id, data: { title: 'Confirmed API record', definitionRevision: 0, values: { hours: 0, approved: false } } };
    const preview = (await tools.call(ctx, 'preview_create_workspace_record', input)).output;
    const action = await tools.call(ctx, 'create_workspace_record', { input: { ...input, fingerprint: preview.fingerprint }, idempotencyKey: `records-${randomUUID()}` });
    assert.equal(await raw.workspaceRecord.count({ where: { organizationId: orgs[0], title: input.data.title } }), 0);
    const receipt = await tools.call(ctx, 'confirm_action', { actionId: action.action.id });
    assert.equal(receipt.action.status, 'EXECUTED');
    assert.equal((await tools.call(ctx, 'confirm_action', { actionId: action.action.id })).idempotent, true);
    assert.equal(await raw.workspaceRecord.count({ where: { organizationId: orgs[0], title: input.data.title } }), 1);
    await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: foreign.id, authorId: users[0].id, title: 'Wrong parent' } }));
    await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[1].id, title: 'Wrong author', values: { hours: 1 } } }));
    await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[0].id, title: 'Foreign relation', values: { hours: 1, client: [clients[1].id] } } }));
    await assert.rejects(createWorkspaceRecord(scoped, source.id, { title: 'Foreign relation', definitionRevision: 0, values: { hours: 1, client: [clients[1].id] } }, users[0]), { statusCode: 404 });
    await assert.rejects(raw.workspaceCollection.update({ where: { id: source.id }, data: { organizationId: orgs[1], authorId: users[1].id } }));
    await assert.rejects(raw.workspaceCollection.update({ where: { id: source.id }, data: { fields: fields.map(field => field.key === 'hours' ? { ...field, type: 'TEXT' } : field) } }));
    await assert.rejects(raw.workspaceCollection.create({ data: { organizationId: orgs[0], authorId: users[0].id, name: 'Foreign collection relation', fields: [{ key: 'work', name: 'Work', type: 'RELATION', collectionId: foreign.id }] } }));

    const definition = [{ key: 'work', name: 'Work', type: 'RELATION', collectionId: source.id }, { key: 'sum', name: 'Sum', type: 'ROLLUP', relationKey: 'work', targetKey: 'hours', aggregate: 'SUM' }, { key: 'balance', name: 'Balance', type: 'FORMULA', expression: { op: 'subtract', args: [{ literal: 40 }, { field: 'sum' }] } }];
    const summary = await createWorkspaceCollection(scoped, { name: 'Capacity', fields: definition }, users[0]);
    const total = await createWorkspaceRecord(scoped, summary.id, { title: 'Week', definitionRevision: 0, values: { work: [a.id, b.id] } }, users[0]);
    assert.equal(total.computed.sum.value, 5);
    assert.equal(total.computed.balance.value, 35);
    assert.equal(total.relations.work[0].name, 'A');
    await assert.rejects(raw.workspaceRecord.update({ where: { id: total.id }, data: { values: { work: [a.id, b.id], sum: 999 } } }));
    await assert.rejects(raw.workspaceCollection.update({ where: { id: source.id }, data: { fields: fields.map(field => field.key === 'hours' ? { ...field, archived: true } : field) } }));
    await assert.rejects(raw.workspaceRecord.update({ where: { id: a.id }, data: { collectionId: summary.id } }));
    const attempts = await Promise.allSettled(['First', 'Second'].map(title => updateWorkspaceRecord(scoped, source.id, a.id, { revision: 0, definitionRevision: 0, title }, users[0])));
    assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.find(result => result.status === 'rejected').reason.statusCode, 409);
    assert.equal((await raw.workspaceRecord.findUnique({ where: { id: a.id } })).revision, 1);

    const countBefore = await raw.workspaceRecord.count({ where: { organizationId: orgs[0] } });
    await assert.rejects(raw.$transaction(async tx => {
      const failing = new Proxy(tx, { get(target, key) { if (key === 'auditEvent') return { ...target.auditEvent, create: async () => { throw new Error('Synthetic audit refusal'); } }; const value = target[key]; return typeof value === 'function' ? value.bind(target) : value; } });
      return createWorkspaceRecordInTransaction(createScopedPrisma(failing, orgs[0]), source.id, { title: 'Must roll back', definitionRevision: 0, values: { hours: 1 } }, users[0]);
    }, { isolationLevel: 'Serializable' }), { statusCode: 503 });
    assert.equal(await raw.workspaceRecord.count({ where: { organizationId: orgs[0] } }), countBefore);

    const configuration = { name: 'Work log', definitionRevision: 0, fields: [{ key: 'hours', required: true, defaultValue: 0 }, { key: 'approved', required: false, defaultValue: false }] };
    const form = await createWorkspaceRecordForm(scoped, source.id, { configuration }, users[0]);
    const submitted = await submitWorkspaceRecordForm(scoped, source.id, form.id, { title: 'Entered with form', revision: 0, definitionRevision: 0, values: {} }, users[0]);
    assert.equal(submitted.values.hours, 0); assert.equal(submitted.values.approved, false);
    assert.ok(await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], action: 'workspace_record_form.submitted', entityId: submitted.id } }));
    await assert.rejects(raw.workspaceRecordForm.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[0].id, configuration: { ...configuration, fields: [...configuration.fields, { key: 'client', required: false, defaultValue: [clients[1].id] }] } } }));
    await updateWorkspaceCollection(scoped, source.id, { revision: 0, fields: [...fields, { key: 'brief', name: 'Brief', type: 'TEXT' }] }, users[0]);
    assert.equal((await listWorkspaceRecordForms(scoped, source.id, {}, users[0])).items[0].needsReview, true);
    await assert.rejects(submitWorkspaceRecordForm(scoped, source.id, form.id, { title: 'Stale', revision: 0, definitionRevision: 1, values: {} }, users[0]), { statusCode: 409 });

    await updateWorkspaceRecord(scoped, source.id, b.id, { revision: 0, definitionRevision: 1, archived: true }, users[0]);
    const partial = await readWorkspaceRecord(scoped, summary.id, total.id, users[0]);
    assert.equal(partial.computed.sum.value, null); assert.equal(partial.computed.sum.error, 'INCOMPLETE_RELATION');
    assert.equal(partial.computed.balance.error, 'DEPENDENCY_ERROR');
    await updateWorkspaceCollection(scoped, source.id, { revision: 1, archived: true }, users[0]);
    await assert.rejects(raw.workspaceRecord.create({ data: { organizationId: orgs[0], collectionId: source.id, authorId: users[0].id, title: 'Archived addition', values: { hours: 1 } } }));
    await assert.rejects(raw.workspaceRecord.update({ where: { id: b.id }, data: { archivedAt: null } }));
    await raw.user.update({ where: { id: users[0].id }, data: { role: 'CLIENT' } });
    await assert.rejects(readWorkspaceRecord(scoped, summary.id, total.id, { ...users[0], role: 'ADMIN' }), { statusCode: 403 });
  } finally {
    await raw.aiBridgeAction.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspaceRecordForm.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspaceRecord.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.workspaceCollection.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
