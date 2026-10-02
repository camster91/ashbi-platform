// PATCH /api/projects/:id/attachments/client-visibility: share (or stop
// sharing) many project files with the client portal in one action, under the
// single-file rule (the uploader or an admin), through the tenant-scoped client.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { default: projectRoutes } = await import('../../routes/project.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { withSession } = await import('../helpers/reauth.js');
const { PROJECT_ATTACHMENT_VISIBILITY_MAX } = await import('../../validators/schemas.js');

const SAM = { id: 'u-sam', role: 'TEAM', organizationId: 'org-a' };
const CASEY = { id: 'u-casey', role: 'TEAM', organizationId: 'org-a' };
const ADMIN = { id: 'u-admin', role: 'ADMIN', organizationId: 'org-a' };

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every((part) => matches(row, part));
    if (key === 'OR') return value.some((part) => matches(row, part));
    if (value && typeof value === 'object' && Array.isArray(value.in)) return value.in.includes(row[key]);
    if (value === null) return row[key] === null || row[key] === undefined;
    return row[key] === value;
  });
}

function pick(row, select) {
  return select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row };
}

function file(id, overrides = {}) {
  return {
    id, organizationId: 'org-a', entityType: 'PROJECT', entityId: 'p-1', uploadedById: 'u-sam',
    clientVisible: false, createdAt: new Date('2026-10-01T00:00:00Z'), ...overrides,
  };
}

// A raw (unscoped) fake database; the routes see it through createScopedPrisma
// exactly as request.prisma, so another organization's rows read as missing.
function fakeDb(attachments) {
  const audit = [];
  const writes = [];
  const projects = [
    { id: 'p-1', organizationId: 'org-a', deletedAt: null },
    { id: 'p-2', organizationId: 'org-a', deletedAt: null },
    { id: 'p-b', organizationId: 'org-b', deletedAt: null },
  ];
  const raw = {
    project: {
      findFirst: async ({ where, select }) => {
        const row = projects.find((project) => matches(project, where));
        return row ? pick(row, select) : null;
      },
    },
    attachment: {
      findMany: async ({ where, select, take }) => attachments.filter((row) => matches(row, where)).slice(0, take ?? Infinity).map((row) => pick(row, select)),
      updateManyAndReturn: async ({ where, data, select }) => {
        writes.push({ where, data });
        const hit = attachments.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data);
        return hit.map((row) => pick(row, select));
      },
    },
    auditEvent: {
      create: async ({ data }) => { audit.push(data); return { id: `audit-${audit.length}`, ...data }; },
    },
  };
  return { raw, audit, writes, attachments };
}

async function buildApp(t, db, user) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => { request.user = withSession(user); });
  app.decorate('prisma', db.raw);
  app.addHook('onRequest', async (request) => {
    request.prisma = createScopedPrisma(db.raw, user.organizationId);
  });
  await app.register(projectRoutes);
  t.after(() => app.close());
  return app;
}

const patch = (app, projectId, payload) => app.inject({ method: 'PATCH', url: `/${projectId}/attachments/client-visibility`, payload });

test('the uploader shares every project file they may change; others are skipped and counted', async (t) => {
  const db = fakeDb([
    file('a-1'),
    file('a-2'),
    file('a-3', { clientVisible: true }),
    file('a-4', { uploadedById: 'u-casey' }),
    file('a-5', { uploadedById: 'u-casey', clientVisible: true }),
    file('t-1', { entityType: 'TASK' }),
    file('o-1', { entityId: 'p-2' }),
  ]);
  const app = await buildApp(t, db, SAM);
  const response = await patch(app, 'p-1', { clientVisible: true });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.deepEqual(body.changedIds.sort(), ['a-1', 'a-2']);
  assert.equal(body.changed, 2);
  assert.equal(body.unchanged, 2, 'already visible files are unchanged, whoever uploaded them');
  assert.deepEqual(body.skipped, [{ id: 'a-4', reason: 'not_permitted' }]);
  assert.equal(db.attachments.find((row) => row.id === 'a-4').clientVisible, false);
  assert.equal(db.attachments.find((row) => row.id === 't-1').clientVisible, false, 'only PROJECT files');
  assert.equal(db.attachments.find((row) => row.id === 'o-1').clientVisible, false, 'only this project');

  // Only the rows that changed are audited, each with the bulk flag.
  assert.deepEqual(db.audit.map((event) => [event.action, event.entityId]).sort(), [
    ['attachment.client_visibility_changed', 'a-1'],
    ['attachment.client_visibility_changed', 'a-2'],
  ]);
  for (const event of db.audit) {
    assert.deepEqual(event.metadata, { projectId: 'p-1', fromVisible: false, toVisible: true, bulk: true });
    assert.equal(event.actorUserId, 'u-sam');
    assert.equal(event.organizationId, 'org-a');
  }
  // The write is a compare-and-set on the current value.
  assert.equal(db.writes[0].data.clientVisible, true);
  assert.ok(matches({ clientVisible: false, organizationId: 'org-a', entityType: 'PROJECT', entityId: 'p-1', id: 'a-1' }, db.writes[0].where));
});

test('an admin changes every file; other staff change only their own', async (t) => {
  const rows = () => [file('a-1'), file('a-2', { uploadedById: 'u-casey' }), file('a-3', { uploadedById: 'u-gone' })];
  const asAdmin = fakeDb(rows());
  const admin = await patch(await buildApp(t, asAdmin, ADMIN), 'p-1', { clientVisible: true });
  assert.deepEqual({ ...admin.json(), changedIds: admin.json().changedIds.sort() }, { changed: 3, changedIds: ['a-1', 'a-2', 'a-3'], unchanged: 0, skipped: [] });

  const asCasey = fakeDb(rows());
  const casey = await patch(await buildApp(t, asCasey, CASEY), 'p-1', { clientVisible: true });
  assert.deepEqual(casey.json().changedIds, ['a-2']);
  assert.deepEqual(casey.json().skipped.map((skip) => skip.id).sort(), ['a-1', 'a-3']);
  assert.ok(casey.json().skipped.every((skip) => skip.reason === 'not_permitted'));
});

test('listed ids from another project or organization are skipped as not found, never changed', async (t) => {
  const db = fakeDb([
    file('a-1'),
    file('o-1', { entityId: 'p-2' }),
    file('x-1', { organizationId: 'org-b', entityId: 'p-b' }),
    file('x-2', { organizationId: 'org-b', entityId: 'p-1' }),
  ]);
  const app = await buildApp(t, db, ADMIN);
  const response = await patch(app, 'p-1', { clientVisible: true, attachmentIds: ['a-1', 'o-1', 'x-1', 'x-2', 'missing', 'a-1'] });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), {
    changed: 1,
    changedIds: ['a-1'],
    unchanged: 0,
    skipped: ['o-1', 'x-1', 'x-2', 'missing'].map((id) => ({ id, reason: 'not_found' })),
  });
  for (const id of ['o-1', 'x-1', 'x-2']) assert.equal(db.attachments.find((row) => row.id === id).clientVisible, false);
  assert.deepEqual(db.audit.map((event) => event.entityId), ['a-1']);

  // Another organization's project reads as missing.
  assert.equal((await patch(app, 'p-b', { clientVisible: true })).statusCode, 404);
  assert.equal((await patch(app, 'nope', { clientVisible: true })).statusCode, 404);
});

test('undo: the inverse value with the exact changed ids restores the previous state', async (t) => {
  const db = fakeDb([file('a-1'), file('a-2'), file('a-3', { clientVisible: true })]);
  const app = await buildApp(t, db, SAM);
  const shared = (await patch(app, 'p-1', { clientVisible: true })).json();
  assert.deepEqual(shared.changedIds.sort(), ['a-1', 'a-2']);
  const undone = await patch(app, 'p-1', { clientVisible: false, attachmentIds: shared.changedIds });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.deepEqual(undone.json().changedIds.sort(), ['a-1', 'a-2']);
  assert.deepEqual(db.attachments.map((row) => [row.id, row.clientVisible]), [['a-1', false], ['a-2', false], ['a-3', true]],
    'the file that was already shared stays shared');
  assert.deepEqual(db.audit.slice(2).map((event) => [event.entityId, event.metadata.fromVisible, event.metadata.toVisible]).sort(), [
    ['a-1', true, false], ['a-2', true, false],
  ]);

  // Running it again changes nothing and audits nothing.
  const again = await patch(app, 'p-1', { clientVisible: false, attachmentIds: shared.changedIds });
  assert.deepEqual(again.json(), { changed: 0, changedIds: [], unchanged: 2, skipped: [] });
  assert.equal(db.audit.length, 4);
});

test('a file another request flipped in the meantime is unchanged, not audited twice', async (t) => {
  const db = fakeDb([file('a-1'), file('a-2')]);
  const original = db.raw.attachment.updateManyAndReturn;
  db.raw.attachment.updateManyAndReturn = async (args) => {
    db.attachments[1].clientVisible = true; // a concurrent single toggle won the race
    return original(args);
  };
  const app = await buildApp(t, db, SAM);
  const response = await patch(app, 'p-1', { clientVisible: true });
  assert.deepEqual(response.json(), { changed: 1, changedIds: ['a-1'], unchanged: 1, skipped: [] });
  assert.deepEqual(db.audit.map((event) => event.entityId), ['a-1']);
});

test('a bulk hide skips files the client uploaded; a bulk share does not', async (t) => {
  const rows = () => [
    file('a-1', { clientVisible: true }),
    file('c-1', { clientVisible: true, uploadedById: 'u-client', uploadedBy: { role: 'CLIENT' } }),
    file('c-2', { uploadedById: 'u-client', uploadedBy: { role: 'CLIENT' } }),
  ];
  const hide = fakeDb(rows());
  const app = await buildApp(t, hide, ADMIN);
  const hidden = await patch(app, 'p-1', { clientVisible: false });
  assert.deepEqual(hidden.json(), { changed: 1, changedIds: ['a-1'], unchanged: 1, skipped: [{ id: 'c-1', reason: 'client_upload' }] });
  assert.equal(hide.attachments.find((row) => row.id === 'c-1').clientVisible, true, 'the client upload stays visible');
  assert.deepEqual(hide.audit.map((event) => event.entityId), ['a-1']);

  // Listing the id explicitly does not get around it.
  const listed = await patch(app, 'p-1', { clientVisible: false, attachmentIds: ['c-1'] });
  assert.deepEqual(listed.json().skipped, [{ id: 'c-1', reason: 'client_upload' }]);

  const share = fakeDb(rows());
  const shared = await patch(await buildApp(t, share, ADMIN), 'p-1', { clientVisible: true });
  assert.deepEqual(shared.json().changedIds, ['c-2'], 'a hidden client upload can be shared again');
});

test('the request is validated and capped', async (t) => {
  const db = fakeDb([file('a-1')]);
  const app = await buildApp(t, db, ADMIN);
  for (const payload of [{}, { clientVisible: 'yes' }, { clientVisible: true, attachmentIds: [] }, { clientVisible: true, extra: 1 }]) {
    assert.equal((await patch(app, 'p-1', payload)).statusCode, 400, JSON.stringify(payload));
  }
  const tooMany = Array.from({ length: PROJECT_ATTACHMENT_VISIBILITY_MAX + 1 }, (_, i) => `id-${i}`);
  assert.equal((await patch(app, 'p-1', { clientVisible: true, attachmentIds: tooMany })).statusCode, 400);
  assert.equal(db.writes.length, 0);

  // A whole-project request over the cap is refused with a plain reason.
  const big = fakeDb(Array.from({ length: PROJECT_ATTACHMENT_VISIBILITY_MAX + 1 }, (_, i) => file(`f-${i}`)));
  const refused = await patch(await buildApp(t, big, ADMIN), 'p-1', { clientVisible: true });
  assert.equal(refused.statusCode, 400);
  assert.equal(refused.json().code, 'TOO_MANY_FILES');
  assert.equal(big.writes.length, 0);
  // Exactly at the cap is fine.
  const atCap = fakeDb(Array.from({ length: PROJECT_ATTACHMENT_VISIBILITY_MAX }, (_, i) => file(`f-${i}`)));
  const ok = await patch(await buildApp(t, atCap, ADMIN), 'p-1', { clientVisible: true });
  assert.equal(ok.json().changed, PROJECT_ATTACHMENT_VISIBILITY_MAX);
});
