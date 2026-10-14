import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import workspaceRecordsRoutes from '../../routes/workspace-records.routes.js';
import { createWorkspaceCollection, updateWorkspaceCollection, listWorkspaceCollections, createWorkspaceRecord, updateWorkspaceRecord, readWorkspaceRecord, listWorkspaceRecords, createWorkspaceRecordForm, updateWorkspaceRecordForm, submitWorkspaceRecordForm, recordRelationOptions } from '../../services/workspace-records.service.js';

function fixture() {
  const state = { user: [{ id: 'u1', organizationId: 'o1', role: 'TEAM', isActive: true }], workspaceCollection: [], workspaceRecord: [], workspaceRecordForm: [], auditEvent: [], client: [{ id: 'c1', organizationId: 'o1', name: 'Canonical client', deletedAt: null }, { id: 'c2', organizationId: 'o2', name: 'Foreign client', deletedAt: null }] };
  let auditFails = false, sequence = 0;
  function matches(row, where = {}) {
    return Object.entries(where).every(([key, expected]) => {
      if (key === 'fields') return expected.array_contains.every(needle => row.fields.some(field => Object.entries(needle).every(([key, value]) => field[key] === value)));
      if (expected && typeof expected === 'object') {
        if (expected.in) return expected.in.includes(row[key]);
        if (expected.gt) return row[key] > expected.gt;
        if (expected.contains !== undefined) return (row[key] ?? '').toLowerCase().includes(expected.contains.toLowerCase());
      }
      return row[key] === expected;
    });
  }
  const prisma = {};
  for (const model of Object.keys(state)) prisma[model] = {
    findFirst: async ({ where }) => structuredClone(state[model].find(row => matches(row, where)) ?? null),
    findMany: async ({ where, take = 100 }) => structuredClone(state[model].filter(row => matches(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take)),
    create: async ({ data }) => {
      if (model === 'auditEvent' && auditFails) throw new Error('Synthetic required audit refusal');
      const row = { id: `r${String(++sequence).padStart(4, '0')}`, revision: 0, schemaRevision: 0, archivedAt: null, ...structuredClone(data) };
      state[model].push(row); return structuredClone(row);
    },
    updateMany: async ({ where, data }) => {
      const rows = state[model].filter(row => matches(row, where));
      for (const row of rows) for (const [key, value] of Object.entries(data)) row[key] = value?.increment !== undefined ? row[key] + value.increment : structuredClone(value);
      return { count: rows.length };
    },
  };
  prisma.$transaction = async (work, options) => {
    assert.equal(options.isolationLevel, 'Serializable');
    const before = structuredClone(state);
    try { return await work(prisma); } catch (error) { for (const key of Object.keys(state)) state[key] = before[key]; throw error; }
  };
  return { prisma, state, actor: { id: 'u1', organizationId: 'o1' }, failAudit: () => { auditFails = true; } };
}
const hours = { key: 'hours', name: 'Hours', type: 'NUMBER', required: true };
const fields = [hours, { key: 'approved', name: 'Approved', type: 'BOOLEAN' }, { key: 'client', name: 'Client', type: 'RELATION', target: 'CLIENT' }, { key: 'total', name: 'Total', type: 'FORMULA', expression: { op: 'multiply', args: [{ field: 'hours' }, { literal: 50 }] } }];
const formConfig = (revision = 0) => ({ name: 'Work log', definitionRevision: revision, fields: [{ key: 'hours', required: true, defaultValue: 0 }, { key: 'approved', required: false, defaultValue: false }] });
async function collection(f, definitions = fields) { return createWorkspaceCollection(f.prisma, { name: 'Work', fields: definitions }, f.actor); }

test('records are standalone, preserve falsy values, calculate results and require current revisions', async () => {
  const f = fixture(), col = await collection(f);
  const record = await createWorkspaceRecord(f.prisma, col.id, { title: 'Design brief', definitionRevision: 0, values: { hours: 0, approved: false, client: ['c1'] } }, f.actor);
  assert.equal(record.computed.total.value, 0);
  assert.equal(record.relations.client[0].name, 'Canonical client');
  assert.equal(record.projectId, undefined);
  const changed = await updateWorkspaceRecord(f.prisma, col.id, record.id, { revision: 0, definitionRevision: 0, values: { hours: 4 } }, f.actor);
  assert.equal(changed.computed.total.value, 200);
  assert.equal(changed.values.approved, false);
  assert.equal(changed.revision, 1);
  await assert.rejects(updateWorkspaceRecord(f.prisma, col.id, record.id, { revision: 0, definitionRevision: 0, title: 'Stale' }, f.actor), { statusCode: 409 });
  await assert.rejects(createWorkspaceRecord(f.prisma, col.id, { title: 'Stale fields', definitionRevision: 1, values: { hours: 1 } }, f.actor), { statusCode: 409 });
});

test('fresh inactive/changed roles and foreign workspace parents/relations are refused', async () => {
  const f = fixture(), col = await collection(f);
  await assert.rejects(createWorkspaceRecord(f.prisma, col.id, { title: 'Foreign', definitionRevision: 0, values: { hours: 1, client: ['c2'] } }, f.actor), { statusCode: 404 });
  assert.equal(f.state.workspaceRecord.length, 0);
  await assert.rejects(listWorkspaceRecords(f.prisma, col.id, {}, { ...f.actor, organizationId: 'o2' }), { statusCode: 403 });
  for (const role of ['CLIENT', 'BOT']) {
    f.state.user[0].role = role;
    await assert.rejects(createWorkspaceRecord(f.prisma, col.id, { title: 'Denied', definitionRevision: 0, values: { hours: 1 } }, { ...f.actor, role: 'ADMIN' }), { statusCode: 403 });
  }
  f.state.user[0].role = 'TEAM'; f.state.user[0].isActive = false;
  await assert.rejects(listWorkspaceCollections(f.prisma, {}, f.actor), { statusCode: 403 });
});

test('archiving retains identity/data; restore under archived collection is refused', async () => {
  const f = fixture(), col = await collection(f);
  const record = await createWorkspaceRecord(f.prisma, col.id, { title: 'Work', definitionRevision: 0, values: { hours: 2 } }, f.actor);
  const archived = await updateWorkspaceRecord(f.prisma, col.id, record.id, { revision: 0, definitionRevision: 0, archived: true }, f.actor);
  assert.deepEqual(archived.values, record.values);
  await assert.rejects(readWorkspaceRecord(f.prisma, col.id, record.id, f.actor), { statusCode: 404 });
  assert.equal((await readWorkspaceRecord(f.prisma, col.id, record.id, f.actor, true)).id, record.id);
  await updateWorkspaceCollection(f.prisma, col.id, { revision: 0, archived: true }, f.actor);
  await assert.rejects(updateWorkspaceRecord(f.prisma, col.id, record.id, { revision: 1, definitionRevision: 0, archived: false }, f.actor), { statusCode: 404 });
});

test('schema updates retain types/choices and cannot make existing active records unusable', async () => {
  const f = fixture(), col = await collection(f);
  await createWorkspaceRecord(f.prisma, col.id, { title: 'Existing', definitionRevision: 0, values: { hours: 0 } }, f.actor);
  const extra = { key: 'brief', name: 'Brief', type: 'TEXT' };
  await assert.rejects(updateWorkspaceCollection(f.prisma, col.id, { revision: 0, fields: [...fields, { ...extra, required: true }] }, f.actor), { statusCode: 400 });
  await assert.rejects(updateWorkspaceCollection(f.prisma, col.id, { revision: 0, fields: fields.map(field => field.key === 'hours' ? { ...field, type: 'TEXT' } : field) }, f.actor), { statusCode: 400 });
  const saved = await updateWorkspaceCollection(f.prisma, col.id, { revision: 0, fields: [...fields, extra] }, f.actor);
  assert.equal(saved.schemaRevision, 1);
  assert.equal(saved.revision, 1);
});

test('required audit failures roll back records, forms and collection revisions', async () => {
  const f = fixture(), col = await collection(f);
  f.failAudit();
  await assert.rejects(createWorkspaceRecord(f.prisma, col.id, { title: 'Rollback', definitionRevision: 0, values: { hours: 1 } }, f.actor), { statusCode: 503 });
  await assert.rejects(createWorkspaceRecordForm(f.prisma, col.id, { configuration: formConfig() }, f.actor), { statusCode: 503 });
  await assert.rejects(updateWorkspaceCollection(f.prisma, col.id, { revision: 0, name: 'Rollback' }, f.actor), { statusCode: 503 });
  assert.equal(f.state.workspaceRecord.length, 0);
  assert.equal(f.state.workspaceRecordForm.length, 0);
  assert.equal(f.state.workspaceCollection[0].name, 'Work');
  assert.equal(f.state.workspaceCollection[0].revision, 0);
});

test('reusable forms create canonical records and stale forms need review after schema changes', async () => {
  const f = fixture(), col = await collection(f);
  const form = await createWorkspaceRecordForm(f.prisma, col.id, { configuration: formConfig() }, f.actor);
  const input = { revision: 0, definitionRevision: 0, title: 'Via form', values: {} };
  const record = await submitWorkspaceRecordForm(f.prisma, col.id, form.id, input, f.actor);
  assert.equal(record.values.hours, 0); assert.equal(record.values.approved, false);
  assert.ok(f.state.auditEvent.some(event => event.action === 'workspace_record_form.submitted'));
  await assert.rejects(submitWorkspaceRecordForm(f.prisma, col.id, form.id, { ...input, values: { total: 999 } }, f.actor), { statusCode: 400 });
  await updateWorkspaceCollection(f.prisma, col.id, { revision: 0, fields: [...fields, { key: 'brief', name: 'Brief', type: 'TEXT' }] }, f.actor);
  await assert.rejects(submitWorkspaceRecordForm(f.prisma, col.id, form.id, input, f.actor), { statusCode: 409 });
  await updateWorkspaceRecordForm(f.prisma, col.id, form.id, { revision: 0, configuration: formConfig(1) }, f.actor);
  assert.equal((await submitWorkspaceRecordForm(f.prisma, col.id, form.id, { ...input, revision: 1, definitionRevision: 1 }, f.actor)).definitionRevision, 1);
});

test('rollups resolve the complete selected roster and never count unavailable records as a subtotal', async () => {
  const f = fixture(), target = await collection(f, [hours]);
  const a = await createWorkspaceRecord(f.prisma, target.id, { title: 'A', definitionRevision: 0, values: { hours: 0 } }, f.actor);
  const b = await createWorkspaceRecord(f.prisma, target.id, { title: 'B', definitionRevision: 0, values: { hours: 5 } }, f.actor);
  const definitions = [{ key: 'work', name: 'Work', type: 'RELATION', collectionId: target.id }, { key: 'sum', name: 'Sum', type: 'ROLLUP', relationKey: 'work', targetKey: 'hours', aggregate: 'SUM' }];
  const parent = await collection(f, definitions);
  const record = await createWorkspaceRecord(f.prisma, parent.id, { title: 'Total', definitionRevision: 0, values: { work: [a.id, b.id] } }, f.actor);
  assert.equal(record.computed.sum.value, 5);
  await assert.rejects(updateWorkspaceCollection(f.prisma, target.id, { revision: 0, fields: [{ ...hours, archived: true }] }, f.actor), { statusCode: 400 });
  await updateWorkspaceRecord(f.prisma, target.id, b.id, { revision: 0, definitionRevision: 0, archived: true }, f.actor);
  const partial = await readWorkspaceRecord(f.prisma, parent.id, record.id, f.actor);
  assert.equal(partial.computed.sum.error, 'INCOMPLETE_RELATION');
  assert.equal(partial.computed.sum.value, null);
  assert.equal(partial.relations.work[1].available, false);
  const cleared = await updateWorkspaceRecord(f.prisma, parent.id, record.id, { revision: 0, definitionRevision: 0, values: { work: [a.id] } }, f.actor);
  assert.equal(cleared.computed.sum.value, 0);
});

test('collection/record/relation pagination is bounded and stable across pages', async () => {
  const f = fixture(), col = await collection(f);
  for (let i = 0; i < 4; i++) await createWorkspaceRecord(f.prisma, col.id, { title: `Record ${i}`, definitionRevision: 0, values: { hours: i } }, f.actor);
  const first = await listWorkspaceRecords(f.prisma, col.id, { limit: 2 }, f.actor);
  const second = await listWorkspaceRecords(f.prisma, col.id, { limit: 2, after: first.nextCursor }, f.actor);
  assert.equal(new Set([...first.items, ...second.items].map(row => row.id)).size, 4);
  assert.equal(second.nextCursor, null);
  await assert.rejects(listWorkspaceRecords(f.prisma, col.id, { limit: 51 }, f.actor), { statusCode: 400 });
  assert.deepEqual((await recordRelationOptions(f.prisma, col.id, 'client', { limit: 1 }, f.actor)).items, [{ id: 'c1', name: 'Canonical client' }]);
});

test('HTTP routes validate bodies/revisions and enforce fresh staff authorization', async () => {
  const f = fixture();
  const app = Fastify();
  app.decorate('authenticate', async (request, reply) => {
    if (request.headers.authorization !== 'Bearer fixture') return reply.code(401).send({ error: 'Unauthorized' });
    request.prisma = f.prisma; request.user = f.actor;
  });
  await app.register(workspaceRecordsRoutes, { prefix: '/api/collections' });
  const headers = { authorization: 'Bearer fixture' };
  try {
    assert.equal((await app.inject({ url: '/api/collections' })).statusCode, 401);
    const created = await app.inject({ method: 'POST', url: '/api/collections', headers, payload: { name: 'HTTP records', fields } });
    assert.equal(created.statusCode, 201);
    const col = created.json();
    assert.equal((await app.inject({ method: 'POST', url: `/api/collections/${col.id}/records`, headers, payload: { title: 'Missing revision', values: { hours: 1 } } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/collections/${col.id}/records`, headers, payload: { title: 'Unknown input', definitionRevision: 0, values: { hours: 1, constructor: 'bad' } } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `/api/collections/${col.id}/records`, headers, payload: { title: 'Foreign relation', definitionRevision: 0, values: { hours: 1, client: ['c2'] } } })).statusCode, 404);
    const record = await app.inject({ method: 'POST', url: `/api/collections/${col.id}/records`, headers, payload: { title: 'HTTP record', definitionRevision: 0, values: { hours: 0 } } });
    assert.equal(record.statusCode, 201);
    assert.equal(record.json().computed.total.value, 0);
    assert.equal((await app.inject({ url: `/api/collections/${col.id}/records?limit=51`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: `/api/collections/${col.id}/records?portfolio=FREELANCE`, headers })).statusCode, 400);
    f.state.user[0].role = 'CLIENT';
    assert.equal((await app.inject({ url: `/api/collections/${col.id}`, headers })).statusCode, 403);
  } finally { await app.close(); }
});

test('malformed relation definitions are refused before reaching Prisma relation queries', async () => {
  const f = fixture();
  await assert.rejects(collection(f, [{ key: 'bad', name: 'Bad', type: 'RELATION', collectionId: { id: 'foreign' } }]), { statusCode: 400 });
});
