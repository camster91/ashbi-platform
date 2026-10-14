import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { canonicalRecordPreview } from '../../integrations/workspace-record-tools.js';
import { createFakeToolDb, seedTwoOrganizations } from '../helpers/fake-tool-db.js';

function fixture() {
  const db = seedTwoOrganizations(createFakeToolDb());
  db.tables.user.forEach(user => { user.isActive = true; });
  const col = { id: 'collection-a', organizationId: 'org-a', authorId: 'team-a', name: 'Work', description: '', fields: [{ key: 'hours', name: 'Hours', type: 'NUMBER', required: true }, { key: 'approved', name: 'Approved', type: 'BOOLEAN' }], revision: 0, schemaRevision: 0, archivedAt: null };
  db.tables.workspaceCollection.push(col, { ...col, id: 'collection-b', organizationId: 'org-b', authorId: 'team-b' });
  const ctx = { prisma: db, user: structuredClone(db.tables.user.find(user => user.id === 'team-a')), scopes: ['workspace:read', 'workspace:actions'] };
  return { db, ctx, tools: createWorkspaceTools(), col };
}
async function prepare(f, name, input, key = 'record-action-001') {
  const preview = (await f.tools.call(f.ctx, `preview_${name}`, input)).output;
  return f.tools.call(f.ctx, name, { input: { ...input, fingerprint: preview.fingerprint }, idempotencyKey: key });
}
test('record actions only prepare, confirm once with an atomic receipt and survive JSONB key reordering', async () => {
  const f = fixture();
  const input = { collectionId: f.col.id, data: { title: 'Work', definitionRevision: 0, values: { hours: 0, approved: false } } };
  const action = await prepare(f, 'create_workspace_record', input);
  assert.equal(f.db.tables.workspaceRecord.length, 0);
  f.db.tables.aiBridgeAction[0].input = canonicalRecordPreview(f.db.tables.aiBridgeAction[0].input);
  const done = await f.tools.call(f.ctx, 'confirm_action', { actionId: action.action.id });
  assert.equal(done.action.status, 'EXECUTED');
  assert.equal(f.db.tables.workspaceRecord.length, 1);
  assert.deepEqual(f.db.tables.workspaceRecord[0].values, { approved: false, hours: 0 });
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: action.action.id })).idempotent, true);
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: action.action.id })).action.status, 'EXECUTED');
  assert.ok(f.db.tables.auditEvent.some(event => event.action === 'workspace_record.created'));
});
test('read-only keys, foreign collections and stale schema previews refuse actions', async () => {
  const f = fixture(), input = { collectionId: f.col.id, data: { title: 'Work', definitionRevision: 0, values: { hours: 1 } } };
  await assert.rejects(f.tools.call({ ...f.ctx, scopes: ['workspace:read'] }, 'create_workspace_record', {}), { code: 'TOOL_UNAVAILABLE' });
  await assert.rejects(f.tools.call(f.ctx, 'preview_create_workspace_record', { ...input, collectionId: 'collection-b' }), { code: 'RECORD_NOT_FOUND' });
  const action = await prepare(f, 'create_workspace_record', input);
  f.col.schemaRevision++;
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: action.action.id }), { code: 'EXECUTION_FAILED', statusCode: 409 });
  assert.equal((await f.tools.call(f.ctx, 'get_action', { actionId: action.action.id })).action.errorCode, 'ACTION_TARGET_UNAVAILABLE');
  assert.equal(f.db.tables.workspaceRecord.length, 0);
});
test('schema-independent context changes invalidate the reviewed fingerprint', async () => {
  const f = fixture(), input = { collectionId: f.col.id, data: { title: 'Work', definitionRevision: 0, values: { hours: 1 } } };
  const action = await prepare(f, 'create_workspace_record', input);
  f.col.name = 'Changed after review';
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: action.action.id }), { code: 'EXECUTION_FAILED', statusCode: 409 });
  assert.equal(f.db.tables.workspaceRecord.length, 0);
});
test('deactivated users cannot retrieve pending or executed record receipts with stale role claims', async () => {
  const f = fixture(), input = { collectionId: f.col.id, data: { title: 'Work', definitionRevision: 0, values: { hours: 1 } } };
  const action = await prepare(f, 'create_workspace_record', input);
  f.db.tables.user.find(user => user.id === f.ctx.user.id).isActive = false;
  for (const name of ['get_action', 'confirm_action']) await assert.rejects(f.tools.call(f.ctx, name, { actionId: action.action.id }), { code: 'ROLE_DENIED' });
  assert.equal(f.db.tables.workspaceRecord.length, 0);
});
test('collection and form writes use the same services, and form submission stays pinned', async () => {
  const f = fixture();
  const created = await prepare(f, 'create_workspace_collection', { data: { name: 'Standalone' } });
  const collection = (await f.tools.call(f.ctx, 'confirm_action', { actionId: created.action.id })).action.result;
  assert.equal(collection.name, 'Standalone');
  const configuration = { name: 'Work form', definitionRevision: 0, fields: [{ key: 'hours', required: true, defaultValue: 0 }, { key: 'approved', required: false, defaultValue: false }] };
  const formAction = await prepare(f, 'create_workspace_record_form', { collectionId: f.col.id, data: { configuration } }, 'record-form-action-001');
  const form = (await f.tools.call(f.ctx, 'confirm_action', { actionId: formAction.action.id })).action.result;
  const submit = await prepare(f, 'submit_workspace_record_form', { collectionId: f.col.id, formId: form.id, data: { title: 'Submitted', revision: 0, definitionRevision: 0, values: {} } }, 'record-form-submit-001');
  assert.equal(f.db.tables.workspaceRecord.length, 0);
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: submit.action.id })).action.status, 'EXECUTED');
  assert.deepEqual(f.db.tables.workspaceRecord[0].values, { hours: 0, approved: false });
});

test('owner-only receipts, expiry and rejection never create records', async () => {
  const f = fixture(), input = { collectionId: f.col.id, data: { title: 'Work', definitionRevision: 0, values: { hours: 1 } } };
  const action = await prepare(f, 'create_workspace_record', input);
  await assert.rejects(f.tools.call({ ...f.ctx, user: { ...f.ctx.user, id: 'team2-a' } }, 'get_action', { actionId: action.action.id }), { code: 'NOT_FOUND' });
  f.db.tables.aiBridgeAction[0].expiresAt = new Date(0);
  await assert.rejects(f.tools.call(f.ctx, 'confirm_action', { actionId: action.action.id }), { code: 'ACTION_EXPIRED' });
  assert.equal(f.db.tables.workspaceRecord.length, 0);
  const other = await prepare(f, 'create_workspace_record', input, 'record-reject-action');
  assert.equal((await f.tools.call(f.ctx, 'reject_action', { actionId: other.action.id })).action.status, 'REJECTED');
  assert.equal(f.db.tables.workspaceRecord.length, 0);
});

test('collection, record and form update actions require review and retain canonical identities', async () => {
  const f = fixture();
  const initial = await prepare(f, 'create_workspace_record', { collectionId: f.col.id, data: { title: 'Original', definitionRevision: 0, values: { hours: 1 } } });
  const record = (await f.tools.call(f.ctx, 'confirm_action', { actionId: initial.action.id })).action.result;
  const update = await prepare(f, 'update_workspace_record', { collectionId: f.col.id, recordId: record.id, data: { revision: 0, definitionRevision: 0, values: { hours: 2 } } }, 'record-update-action');
  assert.equal(f.db.tables.workspaceRecord[0].values.hours, 1);
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: update.action.id })).action.result.id, record.id);
  assert.equal(f.db.tables.workspaceRecord[0].values.hours, 2);
  const change = await prepare(f, 'update_workspace_collection', { collectionId: f.col.id, data: { revision: 0, name: 'Renamed' } }, 'collection-update-action');
  assert.equal((await f.tools.call(f.ctx, 'confirm_action', { actionId: change.action.id })).action.result.name, 'Renamed');
  const config = { name: 'Form', definitionRevision: 0, fields: [{ key: 'hours', required: true }] };
  const createForm = await prepare(f, 'create_workspace_record_form', { collectionId: f.col.id, data: { configuration: config } }, 'form-create-for-update');
  const form = (await f.tools.call(f.ctx, 'confirm_action', { actionId: createForm.action.id })).action.result;
  const archive = await prepare(f, 'update_workspace_record_form', { collectionId: f.col.id, formId: form.id, data: { revision: 0, archived: true } }, 'form-archive-action');
  assert.ok((await f.tools.call(f.ctx, 'confirm_action', { actionId: archive.action.id })).action.result.archivedAt);
});

test('form submission previews refuse foreign relation selections before preparing a write', async () => {
  const f = fixture();
  f.col.fields.push({ key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT' });
  const configuration = { name: 'Client form', definitionRevision: 0, fields: [{ key: 'hours', required: true }, { key: 'client', required: false }] };
  const create = await prepare(f, 'create_workspace_record_form', { collectionId: f.col.id, data: { configuration } });
  const form = (await f.tools.call(f.ctx, 'confirm_action', { actionId: create.action.id })).action.result;
  await assert.rejects(f.tools.call(f.ctx, 'preview_submit_workspace_record_form', { collectionId: f.col.id, formId: form.id, data: { title: 'Denied', revision: 0, definitionRevision: 0, values: { hours: 1, client: ['client-b'] } } }), { code: 'RECORD_NOT_FOUND' });
  assert.equal(f.db.tables.workspaceRecord.length, 0);
  assert.equal(f.db.tables.aiBridgeAction.length, 1);
});
