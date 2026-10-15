import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { listDocumentHistory, readDocumentRevision, restoreDocumentRevision } from '../../services/document-history.service.js';
import { saveNoteAccess } from '../../services/note-access.service.js';
import { saveWorkspacePageAccess } from '../../services/workspace-page-access.service.js';
import { updateWorkspacePage } from '../../services/workspace-pages.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('migrated document history preserves bounded immutable snapshots and current authorization', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000,
}, async t => {
  // Never inherit a customer/development DATABASE_URL as a fallback.
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `history-${key}-${randomUUID()}`);
  try {
    for (const id of orgs) await raw.organization.create({ data: { id, slug: id, name: 'History fixture' } });
    const makeActor = (role, organizationId = orgs[0]) => raw.user.create({ data: {
      role, organizationId, name: 'History fixture', email: `${randomUUID()}@e2e.example.test`, password: randomUUID(),
    } });
    const owner = await makeActor('TEAM'), reader = await makeActor('TEAM');
    const admin = await makeActor('ADMIN'), foreign = await makeActor('ADMIN', orgs[1]);
    const client = await raw.client.create({ data: { name: 'History fixture', organizationId: orgs[0] } });
    const project = await raw.project.create({ data: { name: 'History fixture', organizationId: orgs[0], clientId: client.id } });
    const scoped = createScopedPrisma(raw, orgs[0]);
    const foreignScoped = createScopedPrisma(raw, orgs[1]);

    for (const kind of ['note', 'page']) {
      const model = kind === 'note' ? 'note' : 'workspacePage';
      const history = kind === 'note' ? 'noteRevision' : 'workspacePageRevision';
      const key = kind === 'note' ? 'noteId' : 'pageId';
      const create = data => raw[model].create({ data: {
        title: 'Initial title', content: 'Initial content', authorId: owner.id,
        ...(kind === 'note' ? { projectId: project.id, type: 'NOTE' } : { organizationId: orgs[0] }), ...data,
      } });
      const rows = id => raw[history].findMany({ where: { [key]: id }, orderBy: { revision: 'asc' } });

      await t.test(`${kind}: audience services capture final grants and attribute the actor`, async () => {
        const doc = await create({ accessMode: 'RESTRICTED' });
        const initial = await rows(doc.id);
        const saveAccess = kind === 'note' ? saveNoteAccess : saveWorkspacePageAccess;
        const granted = await saveAccess(scoped, doc.id, {
          revision: 0, mode: 'RESTRICTED', members: [{ userId: reader.id, role: 'READ' }],
        }, owner);
        let snapshots = await rows(doc.id);
        assert.equal(snapshots.length, initial.length + 1);
        const grantSnapshot = snapshots.at(-1);
        assert.equal(grantSnapshot.editedById, owner.id);
        assert.equal(grantSnapshot.audienceNodes[0].accessMode, 'RESTRICTED');
        assert.deepEqual(grantSnapshot.audienceNodes[0].grants, [{ userId: reader.id, role: 'READ' }], 'capture sees the final newly granted reader');
        assert.equal((await readDocumentRevision(scoped, reader, kind, doc.id, grantSnapshot.revision)).content, doc.content);
        assert.deepEqual(snapshots.slice(0, initial.length), initial);

        await saveAccess(scoped, doc.id, { revision: granted.revision, mode: 'RESTRICTED', members: [] }, admin);
        snapshots = await rows(doc.id);
        const revokeSnapshot = snapshots.at(-1);
        assert.equal(revokeSnapshot.editedById, admin.id);
        assert.deepEqual(revokeSnapshot.audienceNodes[0].grants, [], 'capture excludes the removed reader');
        assert.deepEqual(snapshots.at(-2), grantSnapshot, 'removing access does not rewrite the previously granted audience');
        await assert.rejects(readDocumentRevision(scoped, reader, kind, doc.id, grantSnapshot.revision), { statusCode: 404 });
        await assert.rejects(saveAccess(scoped, doc.id, { revision: granted.revision, mode: 'TEAM', members: [] }, owner), { statusCode: 409 });
        assert.deepEqual(await rows(doc.id), snapshots, 'stale access revision creates no snapshot');

        if (kind === 'page') {
          const current = await raw.workspacePage.findUnique({ where: { id: doc.id } });
          await updateWorkspacePage(scoped, doc.id, { revision: current.revision, content: 'Attributed staff content edit' }, owner);
          const edited = (await rows(doc.id)).at(-1);
          assert.equal(edited.content, 'Attributed staff content edit');
          assert.equal(edited.editedById, owner.id, 'content service uses the same actor attribution');
          assert.deepEqual(edited.audienceNodes[0].grants, []);
        }
        await raw[model].delete({ where: { id: doc.id } });
      });

      await t.test(`${kind}: SQL and Prisma writes capture current content, retain 100, and roll back pruning`, async () => {
        const id = `history-doc-${randomUUID()}`;
        if (kind === 'note') {
          await raw.$executeRaw`INSERT INTO notes (id, title, content, "projectId", "authorId", "updatedAt") VALUES (${id}, 'SQL initial', 'SQL content', ${project.id}, ${owner.id}, CURRENT_TIMESTAMP)`;
        } else {
          await raw.$executeRaw`INSERT INTO workspace_pages (id, title, content, "organizationId", "authorId", "updatedAt") VALUES (${id}, 'SQL initial', 'SQL content', ${orgs[0]}, ${owner.id}, CURRENT_TIMESTAMP)`;
        }
        let snapshots = await rows(id);
        assert.equal(snapshots.length, 1);
        assert.equal(snapshots[0].id, `${id}:0`);
        assert.equal(snapshots[0].content, 'SQL content');
        assert.equal(snapshots[0].editedById, null, 'unknown SQL editor is not invented');
        if (kind === 'note') await raw.$executeRaw`UPDATE notes SET content = 'SQL update' WHERE id = ${id}`;
        else await raw.$executeRaw`UPDATE workspace_pages SET content = 'SQL update' WHERE id = ${id}`;
        assert.equal((await rows(id))[1].content, 'SQL update');
        for (let revision = 2; revision <= 100; revision++) {
          await raw[model].update({ where: { id }, data: { content: `Content ${revision}` } });
        }
        snapshots = await rows(id);
        assert.equal(snapshots.length, 100, '101 captured versions retain exactly 100');
        assert.deepEqual(snapshots.map(row => row.revision), Array.from({ length: 100 }, (_, i) => i + 1));
        await assert.rejects(raw.$transaction(async tx => {
          await tx[model].update({ where: { id }, data: { content: 'Must roll back' } });
          assert.equal(await tx[history].count({ where: { [key]: id } }), 100);
          throw new Error('Fixture rollback');
        }), /Fixture rollback/);
        assert.deepEqual(await rows(id), snapshots, 'rollback restores both capture and trimmed oldest snapshot');
        assert.equal((await raw[model].findUnique({ where: { id } })).revision, 100);
        for (let revision = 101; revision <= 104; revision++) {
          await raw[model].update({ where: { id }, data: { content: `Content ${revision}` } });
        }
        snapshots = await rows(id);
        assert.equal(snapshots.length, 100, '105 captured versions still retain exactly 100');
        assert.equal(snapshots[0].revision, 5);
        const current = await raw[model].findUnique({ where: { id } });
        assert.equal(snapshots.at(-1).revision, current.revision);
        assert.equal(snapshots.at(-1).content, current.content);

        const snapshot = snapshots.at(-1);
        const { id: unusedId, ...copy } = snapshot;
        assert.ok(unusedId);
        await assert.rejects(raw[history].create({ data: { ...copy, id: randomUUID(), revision: 999 } }), /database-owned and immutable/);
        await assert.rejects(raw[history].update({ where: { id: snapshot.id }, data: { content: 'Tamper' } }), /database-owned and immutable/);
        await assert.rejects(raw[history].delete({ where: { id: snapshot.id } }), /database-owned and immutable/);
        for (const method of ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany']) {
          await assert.rejects(scoped[history][method]({}), /snapshots are database-owned/);
        }
        assert.deepEqual(await rows(id), snapshots, 'denied direct writes leave all retained snapshots intact');
        await raw[model].delete({ where: { id } });
        assert.equal(await raw[history].count({ where: { [key]: id } }), 0, 'document deletion cascades through immutability guard');
      });

      await t.test(`${kind}: historical audiences intersect fresh access and restoration preserves current structure`, async () => {
        const parent = await create({ title: 'Parent' });
        const doc = await create({ parentId: parent.id, accessMode: 'RESTRICTED', content: 'Originally private' });
        const hiddenVersion = doc.revision;
        await raw[model].update({ where: { id: doc.id }, data: { accessMode: 'TEAM', content: 'Now shared' } });
        let current = await raw[model].findUnique({ where: { id: doc.id } });
        const sharedVersion = current.revision;
        const available = await listDocumentHistory(scoped, reader, kind, doc.id);
        assert.equal(available.limit, 100);
        assert.deepEqual(available.items.map(row => row.revision), [sharedVersion]);
        assert.equal(available.items[0].isCurrent, true);
        await assert.rejects(readDocumentRevision(scoped, reader, kind, doc.id, hiddenVersion), { statusCode: 404 });
        assert.equal((await readDocumentRevision(scoped, admin, kind, doc.id, hiddenVersion)).content, 'Originally private');
        await assert.rejects(listDocumentHistory(foreignScoped, foreign, kind, doc.id), { statusCode: 404 });
        assert.equal(await foreignScoped[history].count({ where: { [key]: doc.id } }), 0);
        await assert.rejects(restoreDocumentRevision(scoped, owner, kind, doc.id, hiddenVersion, { revision: current.revision }), { statusCode: 403 });
        await assert.rejects(restoreDocumentRevision(scoped, admin, kind, doc.id, hiddenVersion, { revision: current.revision + 1 }), { statusCode: 409 });
        assert.equal((await raw[model].findUnique({ where: { id: doc.id } })).revision, current.revision);

        if (kind === 'note') await raw.note.update({ where: { id: doc.id }, data: { mentions: JSON.stringify([reader.id]), tags: '["current"]' } });
        current = await raw[model].findUnique({ where: { id: doc.id } });
        const before = await rows(doc.id);
        const failingAudit = new Proxy(scoped, { get(target, property) {
          if (property === '$transaction') return (work, options) => target.$transaction(tx => work(new Proxy(tx, { get(client, key) {
            if (key === 'auditEvent') return { create: async () => { throw new Error('Fixture audit unavailable'); } };
            return client[key];
          } })), options);
          return target[property];
        } });
        await assert.rejects(restoreDocumentRevision(failingAudit, admin, kind, doc.id, hiddenVersion, { revision: current.revision }), { statusCode: 503 });
        assert.deepEqual(await rows(doc.id), before, 'failed audit rolls back the newly captured restore');
        assert.deepEqual(await raw[model].findUnique({ where: { id: doc.id } }), current);
        const restored = await restoreDocumentRevision(scoped, admin, kind, doc.id, hiddenVersion, { revision: current.revision });
        const after = await raw[model].findUnique({ where: { id: doc.id } });
        assert.equal(restored.sourceRevision, hiddenVersion);
        assert.equal(restored.revision, current.revision + 1);
        assert.equal(after.content, 'Originally private');
        for (const field of ['parentId', 'authorId', 'accessMode', 'accessRevision', ...(kind === 'note' ? ['projectId', 'accessGrants', 'audienceBarrier', 'mentions'] : ['organizationId'])]) {
          assert.deepEqual(after[field], current[field], `${field} remains current rather than restored`);
        }
        assert.deepEqual((await rows(doc.id)).slice(0, -1), before, 'restore appends instead of rewriting its source');
        assert.equal((await rows(doc.id)).at(-1).editedById, admin.id);
        const audit = await raw.auditEvent.findFirst({ where: { organizationId: orgs[0], entityId: doc.id, action: kind === 'note' ? 'note.revision_restored' : 'workspace_page.revision_restored' } });
        assert.ok(audit, 'restore includes an audit event');
        assert.equal(audit.actorUserId, admin.id);
        assert.deepEqual(audit.metadata, { sourceRevision: hiddenVersion, previousRevision: current.revision, revision: restored.revision });
        assert.equal((await readDocumentRevision(scoped, reader, kind, doc.id, restored.revision)).content, 'Originally private', 'new restoration uses today’s shared audience');
        await assert.rejects(restoreDocumentRevision(scoped, admin, kind, doc.id, hiddenVersion, { revision: current.revision }), { statusCode: 409 });

        await raw[model].update({ where: { id: doc.id }, data: { accessMode: 'RESTRICTED' } });
        await assert.rejects(listDocumentHistory(scoped, reader, kind, doc.id), { statusCode: 404 });
        await assert.rejects(readDocumentRevision(scoped, reader, kind, doc.id, sharedVersion), { statusCode: 404 });
        await raw.user.update({ where: { id: admin.id }, data: { role: 'TEAM' } });
        await assert.rejects(readDocumentRevision(scoped, admin, kind, doc.id, hiddenVersion), { statusCode: 404 }, 'stale ADMIN actor is reloaded');
        await raw.user.update({ where: { id: admin.id }, data: { role: 'ADMIN', isActive: false } });
        await assert.rejects(listDocumentHistory(scoped, admin, kind, doc.id), { statusCode: 403 });
        await raw.user.update({ where: { id: admin.id }, data: { isActive: true } });
        await raw[model].delete({ where: { id: doc.id } });
        await raw[model].delete({ where: { id: parent.id } });
      });
    }
  } finally {
    try {
      // IDs exist before setup and cannot become undefined broad filters.
      await raw.workspacePage.updateMany({ where: { organizationId: { in: orgs } }, data: { parentId: null } });
      await raw.workspacePage.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.note.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
      await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
      if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    } finally {
      await raw.$disconnect();
    }
  }
});
