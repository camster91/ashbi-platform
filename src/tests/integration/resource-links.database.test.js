import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { createResourceLink, updateResourceLink, archiveResourceLink, reorderResourceLinks, listResourceLinks, listClientResourceLinks, prepareUpdateResourceLink, updateResourceLinkInTransaction, prepareReorderResourceLinks, reorderResourceLinksInTransaction } from '../../services/resource-links.service.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('resource links migrated PostgreSQL invariants and transactional workflows', { skip: !url && 'Disposable PostgreSQL not configured', timeout: 120000 }, async (t) => {
    assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
    const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const suffix = randomUUID(), orgs = [`resources-a-${suffix}`, `resources-b-${suffix}`];
    let project, client, task, actor, other, admin, foreign, clientActor;
    try {
        for (const id of orgs)
            await db.organization.create({ data: { id, slug: id, name: 'Resource fixture' } });
        client = await db.client.create({ data: { name: 'Resource client', organizationId: orgs[0] } });
        project = await db.project.create({ data: { name: 'Historical completed resource project', organizationId: orgs[0], clientId: client.id, completedAt: new Date() } });
        task = await db.task.create({ data: { title: 'Resource task', projectId: project.id, status: 'COMPLETED' } });
        const makeUser = (name, role, organizationId = orgs[0]) => db.user.create({ data: { name, role, organizationId, password: randomUUID(), email: `${name}-${suffix}@example.invalid` } });
        actor = await makeUser('staff', 'TEAM');
        other = await makeUser('other', 'TEAM');
        admin = await makeUser('admin', 'ADMIN');
        foreign = await makeUser('foreign', 'ADMIN', orgs[1]);
        clientActor = await makeUser('client', 'CLIENT');
        const base = { actor, entityType: 'PROJECT', entityId: project.id, title: 'Source reference', url: 'https://example.invalid/a?x=1&x=2#part' };
        const create = (fields = {}) => createResourceLink(db, { ...base, createIntentId: randomUUID(), ...fields });
        let first, second;
        await t.test('equal URLs are separate records and exact intents replay without new audit', async () => {
            const intent = randomUUID();
            first = await create({ createIntentId: intent });
            second = await create();
            assert.notEqual(first.id, second.id);
            assert.equal(first.url, base.url);
            assert.equal((await create({ createIntentId: intent })).id, first.id);
            await assert.rejects(create({ createIntentId: intent, title: 'Changed' }), { statusCode: 409 });
            assert.equal(await db.auditEvent.count({ where: { organizationId: orgs[0], action: 'resource_link.create' } }), 2);
        });
        await t.test('stored client/bot/inactive actors and cross org parents are denied', async () => {
            await assert.rejects(create({ actor: { ...clientActor, role: 'ADMIN' } }), { statusCode: 403 });
            await assert.rejects(create({ actor: foreign }), { statusCode: 404 });
            await db.user.update({ where: { id: other.id }, data: { isActive: false } });
            await assert.rejects(create({ actor: other }), { statusCode: 403 });
            await db.user.update({ where: { id: other.id }, data: { isActive: true } });
        });
        await t.test('real composite foreign keys prevent cross org and wrong project tasks', async () => {
            const row = await db.resourceLink.findUnique({ where: { id: first.id } });
            const { id, createdAt, updatedAt, ...data } = row;
            await assert.rejects(db.resourceLink.create({ data: { ...data, organizationId: orgs[1], createIntentId: randomUUID() } }), e => e.code === 'P2003');
            const p2 = await db.project.create({ data: { name: 'Other project', organizationId: orgs[0], clientId: client.id } });
            await assert.rejects(db.resourceLink.create({ data: { ...data, projectId: p2.id, taskId: task.id, createIntentId: randomUUID() } }), e => e.code === 'P2003');
        });
        await t.test('owner/admin edits use current revisions and preserve provenance in database', async () => {
            await assert.rejects(updateResourceLink(db, { actor: other, id: first.id, expectedRevision: 1, title: 'Denied' }), { statusCode: 403 });
            first = await updateResourceLink(db, { actor: admin, id: first.id, expectedRevision: 1, title: 'Administrator edit' });
            assert.equal(first.revision, 2);
            await assert.rejects(updateResourceLink(db, { actor, id: first.id, expectedRevision: 1, title: 'Stale' }), { statusCode: 409 });
            await assert.rejects(db.resourceLink.update({ where: { id: first.id }, data: { source: { system: 'forged' }, revision: 3 } }));
            await assert.rejects(db.resourceLink.update({ where: { id: first.id }, data: { createdById: other.id, revision: 3 } }));
            await assert.rejects(db.resourceLink.delete({ where: { id: first.id } }));
        });
        await t.test('archive restore hide and retain records with CAS', async () => {
            first = await archiveResourceLink(db, { actor, id: first.id, expectedRevision: 2, archived: true });
            assert.ok(first.archivedAt);
            assert.equal((await listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id })).items.length, 1);
            first = await archiveResourceLink(db, { actor, id: first.id, expectedRevision: 3, archived: false });
            assert.equal(first.revision, 4);
            assert.equal(first.archivedAt, null);
        });
        await t.test('full reorder rejects omission and applies atomic ordered revisions', async () => {
            await assert.rejects(reorderResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id, ordered: [{ id: first.id, expectedRevision: 4 }] }), { statusCode: 409 });
            const result = await reorderResourceLinks(db, { actor: other, entityType: 'PROJECT', entityId: project.id, ordered: [{ id: second.id, expectedRevision: 1 }, { id: first.id, expectedRevision: 4 }] });
            assert.deepEqual(result.items.map(r => r.id), [second.id, first.id]);
            first = result.items[1];
            second = result.items[0];
        });
        await t.test('two simultaneous CAS edits have exactly one winner', async () => {
            const results = await Promise.allSettled(['one', 'two'].map(title => updateResourceLink(db, { actor, id: first.id, expectedRevision: first.revision, title })));
            assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(results.find(r => r.status === 'rejected').reason.statusCode, 409);
            first = results.find(r => r.status === 'fulfilled').value;
        });
        await t.test('prepared operations reject actor revocation and new resource membership', async () => {
            const prepared = await prepareUpdateResourceLink(db, { actor, id: first.id, expectedRevision: first.revision, title: 'Prepared' });
            await db.user.update({ where: { id: actor.id }, data: { role: 'CLIENT' } });
            await assert.rejects(db.$transaction(tx => updateResourceLinkInTransaction(tx, prepared)), { statusCode: 403 });
            await db.user.update({ where: { id: actor.id }, data: { role: 'TEAM' } });
            const reorder = await prepareReorderResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id, ordered: [{ id: second.id, expectedRevision: second.revision }, { id: first.id, expectedRevision: first.revision }] });
            await create();
            await assert.rejects(db.$transaction(tx => reorderResourceLinksInTransaction(tx, reorder)), { statusCode: 409 });
        });
        await t.test('portal projection contains only explicit shares on live canonical task parents', async () => {
            const shared = await create({ entityType: 'TASK', entityId: task.id, clientVisible: true, source: { system: 'manual', recordId: 'original-1', originalTitle: 'Original', originalUrl: base.url, originalCreatedAt: 'exact historical text', originalPosition: 3 } });
            const result = await listClientResourceLinks(db, { organizationId: orgs[0], clientId: client.id, projectId: project.id });
            assert.equal(result.items.length, 1);
            assert.equal(result.items[0].id, shared.id);
            assert.deepEqual(Object.keys(result.items[0]), ['id', 'title', 'url', 'position', 'updatedAt']);
            await db.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
            assert.equal((await listClientResourceLinks(db, { organizationId: orgs[0], clientId: client.id, projectId: project.id })).items.length, 0);
            await db.task.update({ where: { id: task.id }, data: { deletedAt: null } });
            await assert.rejects(listClientResourceLinks(db, { organizationId: orgs[1], clientId: client.id, projectId: project.id }), { statusCode: 404 });
            await db.client.update({ where: { id: client.id }, data: { status: 'PAUSED' } });
            await assert.rejects(listClientResourceLinks(db, { organizationId: orgs[0], clientId: client.id, projectId: project.id }), { statusCode: 404 });
            assert.ok((await listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id })).items.length > 0);
            await db.client.update({ where: { id: client.id }, data: { status: 'ACTIVE', relationshipStatus: 'ARCHIVED' } });
            await assert.rejects(listClientResourceLinks(db, { organizationId: orgs[0], clientId: client.id, projectId: project.id }), { statusCode: 404 });
            await db.client.update({ where: { id: client.id }, data: { relationshipStatus: 'ACTIVE' } });
        });
        await t.test('real tenant proxy recognizes ResourceLink while refusing forged parent/creator', async () => {
            const scoped = createScopedPrisma(db, orgs[0]);
            assert.ok((await listResourceLinks(scoped, { actor, entityType: 'PROJECT', entityId: project.id })).items.length > 0);
            assert.equal(await createScopedPrisma(db, orgs[1]).resourceLink.count({}), 0);
            await assert.rejects(createScopedPrisma(db, orgs[1]).resourceLink.create({ data: { projectId: project.id, createdById: foreign.id, createIntentId: randomUUID(), inputHash: 'a'.repeat(64), title: 'Forged', url: base.url, position: 0 } }));
        });
        await t.test('audit failure rolls back real PostgreSQL mutation', async () => {
            const before = await db.resourceLink.count({ where: { organizationId: orgs[0] } });
            const failing = { ...db, $transaction: (work, options) => db.$transaction(tx => work(new Proxy(tx, { get(target, key) {
                        if (key === 'auditEvent')
                            return { create: async () => { throw new Error('synthetic audit unavailable'); } };
                        const value = target[key];
                        return typeof value === 'function' ? value.bind(target) : value;
                    } })), options) };
            await assert.rejects(createResourceLink(failing, { ...base, createIntentId: randomUUID() }), /synthetic audit unavailable/);
            assert.equal(await db.resourceLink.count({ where: { organizationId: orgs[0] } }), before);
        });
        await t.test('500 active cap serializes competing creates and blocks restore overflow', async () => {
            const capProject = await db.project.create({ data: { name: 'Capacity fixture', organizationId: orgs[0], clientId: client.id } });
            const seed = Array.from({ length: 499 }, (_, position) => ({ organizationId: orgs[0], projectId: capProject.id, createdById: actor.id, createIntentId: randomUUID(), inputHash: 'a'.repeat(64), title: 'Capacity seed', url: base.url, position }));
            await db.resourceLink.createMany({ data: seed });
            const attempts = await Promise.allSettled([1, 2].map(() => create({ entityId: capProject.id })));
            assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
            assert.equal(attempts.find(x => x.status === 'rejected').reason.statusCode, 409);
            assert.equal(await db.resourceLink.count({ where: { projectId: capProject.id, archivedAt: null } }), 500);
            const winner = attempts.find(x => x.status === 'fulfilled').value;
            await archiveResourceLink(db, { actor, id: winner.id, expectedRevision: 1, archived: true });
            await create({ entityId: capProject.id });
            await assert.rejects(archiveResourceLink(db, { actor, id: winner.id, expectedRevision: 2, archived: false }), { statusCode: 409 });
            await assert.rejects(db.resourceLink.create({ data: { ...seed[0], createIntentId: randomUUID() } }));
        });
        await t.test('pagination is stable with tied positions and unavailable parents are denied', async () => {
            const p1 = await listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id, limit: 1 });
            assert.ok(p1.nextCursor);
            const p2 = await listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id, limit: 1, after: p1.nextCursor });
            assert.notEqual(p1.items[0].id, p2.items[0].id);
            await db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
            await assert.rejects(create(), { statusCode: 404 });
            await assert.rejects(listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: project.id }), { statusCode: 404 });
        });
    }
    finally {
        await db.$transaction(async (tx) => { await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica'); await tx.$executeRawUnsafe('DELETE FROM resource_links WHERE "organizationId" = ANY($1::text[])', orgs); });
        if (await purgeFixtureAuditEvents(db, { ids: orgs })) {
            await db.task.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
            await db.project.deleteMany({ where: { organizationId: { in: orgs } } });
            await db.user.deleteMany({ where: { organizationId: { in: orgs } } });
            await db.client.deleteMany({ where: { organizationId: { in: orgs } } });
            await db.organization.deleteMany({ where: { id: { in: orgs } } });
        }
        await db.$disconnect();
    }
});
