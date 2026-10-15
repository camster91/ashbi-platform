import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { listDocumentHistory, readDocumentRevision, restoreDocumentRevision } from '../../services/document-history.service.js';
import documentHistoryRoutes from '../../routes/document-history.routes.js';

function fixture(kind = 'page') {
  const actor = { id: 'owner', organizationId: 'org', role: 'ADMIN', isActive: true };
  let staff = { ...actor };
  let document = { id: 'doc', organizationId: 'org', projectId: 'project', parentId: null, authorId: 'owner', accessMode: 'TEAM', accessRevision: 0, revision: 4, title: 'Current', content: 'Current content', archivedAt: null, deletedAt: null, grants: [], accessGrants: [], audienceBarrier: null, mentions: '["keep-mentioned"]', type: 'NOTE', tags: '["current"]', isPinned: false, isTemplate: false };
  const nodes = [{ id: 'doc', organizationId: 'org', ...(kind === 'note' ? { projectId: 'project' } : {}), parentId: null, authorId: 'owner', accessMode: 'TEAM', grants: [], audienceBarrier: null }];
  const revisions = [4, 3, 2].map(revision => ({ id: `history-${revision}`, organizationId: 'org', ...(kind === 'note' ? { noteId: 'doc' } : { pageId: 'doc' }), revision, title: `Title ${revision}`, content: `Content ${revision}`, recordedAt: new Date(), editedById: 'owner', audienceNodes: structuredClone(nodes), type: 'NOTE', tags: '["historic"]', isPinned: true, isTemplate: true }));
  const state = { audits: [], writes: [], settings: [], auditFails: false, conflict: false };
  const sameTenant = where => (!where.organizationId || where.organizationId === 'org') && (!where.project || where.project.organizationId === 'org');
  const model = {
    findMany: async ({ where }) => sameTenant(where) && where.id.in.includes('doc') ? [structuredClone(document)] : [],
    findFirst: async ({ where }) => sameTenant(where) && where.id === 'doc' ? structuredClone(document) : null,
    updateMany: async ({ where, data }) => {
      if (state.conflict || !sameTenant(where) || where.revision !== document.revision) return { count: 0 };
      state.writes.push(structuredClone(data)); document = { ...document, ...data, revision: document.revision + 1 };
      revisions.unshift({ ...structuredClone(revisions[0]), ...data, revision: document.revision });
      return { count: 1 };
    },
  };
  const history = {
    findMany: async args => { assert.equal(args.take, 100); assert.deepEqual(args.orderBy, { revision: 'desc' }); return sameTenant(args.where) ? structuredClone(revisions.slice(0, 100)) : []; },
    findFirst: async ({ where }) => sameTenant(where) ? structuredClone(revisions.find(row => row.revision === where.revision) ?? null) : null,
  };
  const db = {
    user: { findFirst: async ({ where }) => staff?.id === where.id && staff.organizationId === where.organizationId && staff.isActive && ['ADMIN', 'TEAM'].includes(staff.role) ? { ...staff } : null },
    note: model, workspacePage: model, noteRevision: history, workspacePageRevision: history,
    auditEvent: { create: async ({ data }) => { if (state.auditFails) throw new Error('Synthetic audit failure'); state.audits.push(data); return { id: 'audit', ...data }; } },
    $executeRaw: async (strings, ...values) => { state.settings.push({ sql: strings.join('?'), values }); return 1; },
    $transaction: async (work, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      const before = structuredClone({ document, revisions, audits: state.audits });
      try { return await work(db); } catch (error) { document = before.document; revisions.splice(0, revisions.length, ...before.revisions); state.audits.splice(0, state.audits.length, ...before.audits); throw error; }
    },
  };
  return { db, actor, state, revisions, document: () => document, staff: value => { staff = value; } };
}

for (const kind of ['page', 'note']) {
  test(`${kind} history filters historical audience before listing and never returns ACL metadata`, async () => {
    const f = fixture(kind); const team = { ...f.actor, role: 'TEAM' }; f.staff(team);
    f.revisions[1].audienceNodes[0] = { ...f.revisions[1].audienceNodes[0], authorId: 'someone-else', accessMode: 'RESTRICTED' };
    const list = await listDocumentHistory(f.db, team, kind, 'doc');
    assert.deepEqual(list.items.map(row => row.revision), [4, 2]); assert.equal(list.limit, 100); assert.equal(list.currentRevision, 4);
    assert.equal(list.items[0].isCurrent, true); assert.equal('audienceNodes' in list.items[0], false); assert.equal('content' in list.items[0], false);
    await assert.rejects(readDocumentRevision(f.db, team, kind, 'doc', 3), { statusCode: 404 });
    const detail = await readDocumentRevision(f.db, team, kind, 'doc', 2);
    assert.equal(detail.content, 'Content 2'); assert.equal(detail.currentRevision, 4); assert.equal('audienceNodes' in detail, false); assert.equal('organizationId' in detail, false);
  });
  test(`${kind} history requires current document access and fresh active same-tenant staff`, async () => {
    const f = fixture(kind);
    await assert.rejects(listDocumentHistory(f.db, { ...f.actor, organizationId: 'foreign' }, kind, 'doc'), { statusCode: 403 });
    f.staff({ ...f.actor, isActive: false }); await assert.rejects(listDocumentHistory(f.db, f.actor, kind, 'doc'), { statusCode: 403 });
    f.staff({ ...f.actor, role: 'CLIENT' }); await assert.rejects(readDocumentRevision(f.db, f.actor, kind, 'doc', 2), { statusCode: 403 });
    const team = { ...f.actor, id: 'other', role: 'TEAM' }; f.staff(team);
    f.document().accessMode = 'RESTRICTED'; await assert.rejects(listDocumentHistory(f.db, team, kind, 'doc'), { statusCode: 404 });
  });
  test(`${kind} restore makes a new revision with content-only changes and bounded audit metadata`, async () => {
    const f = fixture(kind); const old = structuredClone(f.document());
    assert.deepEqual(await restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 4 }), { documentId: 'doc', revision: 5, sourceRevision: 2 });
    assert.equal(f.document().content, 'Content 2'); assert.equal(f.document().title, 'Title 2');
    for (const key of ['authorId', 'organizationId', 'projectId', 'parentId', 'mentions', 'accessMode', 'accessRevision', 'accessGrants', 'audienceBarrier']) assert.deepEqual(f.document()[key], old[key]);
    assert.deepEqual(Object.keys(f.state.writes[0]).sort(), (kind === 'note' ? ['title', 'content', 'type', 'tags', 'isPinned', 'isTemplate'] : ['title', 'content']).sort());
    assert.deepEqual(f.state.settings[0].values, ['owner']); assert.match(f.state.settings[0].sql, /set_config/);
    assert.equal(f.state.audits.length, 1); assert.deepEqual(f.state.audits[0].metadata, { sourceRevision: 2, previousRevision: 4, revision: 5 });
    assert.equal(f.revisions[0].revision, 5); assert.equal(f.revisions.at(-1).content, 'Content 2');
  });
  test(`${kind} restore refuses stale/demoted actors, CAS races and missing audit`, async () => {
    const f = fixture(kind);
    await assert.rejects(restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 3 }), { statusCode: 409 });
    f.staff({ ...f.actor, role: 'TEAM' }); await assert.rejects(restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 4 }), { statusCode: 403 });
    f.staff(f.actor); f.state.conflict = true; await assert.rejects(restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 4 }), { statusCode: 409 });
    f.state.conflict = false; f.state.auditFails = true; await assert.rejects(restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 4 }), { statusCode: 503 });
    assert.equal(f.document().revision, 4); assert.equal(f.document().content, 'Current content'); assert.equal(f.state.audits.length, 0);
  });
  test(`${kind} history fails closed for malformed or foreign historical audiences`, async () => {
    const f = fixture(kind); const team = { ...f.actor, role: 'TEAM' }; f.staff(team);
    f.revisions[0].audienceNodes[0].parentId = 'missing-parent';
    f.revisions[1].audienceNodes[0].organizationId = 'foreign';
    assert.deepEqual((await listDocumentHistory(f.db, team, kind, 'doc')).items.map(row => row.revision), [2]);
    await assert.rejects(readDocumentRevision(f.db, team, kind, 'doc', 4), { statusCode: 404 });
    await assert.rejects(readDocumentRevision(f.db, team, kind, 'doc', 999), { statusCode: 404 });
  });
  test(`${kind} restore rolls back if the database did not record its new snapshot`, async () => {
    const f = fixture(kind); const history = kind === 'note' ? f.db.noteRevision : f.db.workspacePageRevision;
    const read = history.findFirst;
    history.findFirst = args => args.where.revision === 5 ? null : read(args);
    await assert.rejects(restoreDocumentRevision(f.db, f.actor, kind, 'doc', 2, { revision: 4 }), { statusCode: 503 });
    assert.equal(f.document().revision, 4); assert.equal(f.state.audits.length, 0);
  });
}

for (const type of ['MEETING_NOTES', 'WIKI', 'DOC']) {
  test(`note history restores supported ${type} templates as a new revision`, async () => {
    const f = fixture('note'); f.revisions.at(-1).type = type;
    await restoreDocumentRevision(f.db, f.actor, 'note', 'doc', 2, { revision: 4 });
    assert.equal(f.document().type, type); assert.equal(f.document().isTemplate, true);
    assert.equal(f.document().revision, 5); assert.equal(f.revisions[0].type, type);
    assert.equal(f.document().mentions, '["keep-mentioned"]');
  });
}

test('note history retains unsupported stored types for reading but rejects restoring them', async () => {
  const f = fixture('note'); f.revisions.at(-1).type = 'UNSUPPORTED';
  assert.equal((await readDocumentRevision(f.db, f.actor, 'note', 'doc', 2)).type, 'UNSUPPORTED');
  await assert.rejects(restoreDocumentRevision(f.db, f.actor, 'note', 'doc', 2, { revision: 4 }), { statusCode: 409 });
  assert.equal(f.document().revision, 4); assert.equal(f.state.writes.length, 0);
});

test('history HTTP routes authenticate, reject malformed inputs and hide unexpected errors', async () => {
  const f = fixture(); const app = Fastify();
  app.decorate('authenticate', async request => {
    if (!request.headers['x-test-role']) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    request.user = { ...f.actor, role: request.headers['x-test-role'] }; request.prisma = f.db;
  });
  await app.register(documentHistoryRoutes, { prefix: '/api/document-history' });
  const headers = { 'x-test-role': 'ADMIN' }; const url = '/api/document-history/pages/doc';
  try {
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { 'x-test-role': 'CLIENT' } })).statusCode, 403);
    assert.equal((await app.inject({ url: `${url}?includePrivate=true`, headers })).statusCode, 400);
    assert.equal((await app.inject({ url: `${url}/invalid`, headers })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: `${url}/2/restore`, headers, payload: { revision: 4, parentId: 'other' } })).statusCode, 400);
    assert.equal((await app.inject({ url, headers })).json().items.length, 3);
    f.db.workspacePageRevision.findMany = async () => { throw new Error('DO NOT LEAK INTERNAL SQL'); };
    const failure = await app.inject({ url, headers }); assert.equal(failure.statusCode, 503); assert.doesNotMatch(failure.body, /INTERNAL SQL/);
  } finally { await app.close(); }
});
