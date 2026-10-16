import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceLinkCreateSchema, resourceLinkUpdateSchema } from '../../validators/resource-links.schemas.js';
import { prepareCreateResourceLink } from '../../services/resource-links.service.js';
const valid = { entityType: 'PROJECT', entityId: 'p', title: 'Design', url: 'https://example.com/a?x=1&x=2#part', createIntentId: 'b158ed91-2b98-40ca-91eb-eed719730491' };
test('exact URL preserved and unsafe destinations rejected without outbound calls', () => {
    assert.equal(resourceLinkCreateSchema.parse(valid).url, valid.url);
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/a b', 'https://example.com/\\x', 'https://example.com/\n'])
        assert.equal(resourceLinkCreateSchema.safeParse({ ...valid, url }).success, false, url);
});
test('source is immutable; update rejects parent and creation fields', () => {
    for (const field of ['source', 'createdById', 'projectId', 'entityId', 'createIntentId'])
        assert.equal(resourceLinkUpdateSchema.safeParse({ expectedRevision: 1, [field]: 'x' }).success, false);
});
test('current stored actor is required even when supplied role claims ADMIN', async () => {
    const db = { user: { findFirst: async () => ({ id: 'a', organizationId: 'o', role: 'CLIENT', isActive: true }) } };
    await assert.rejects(prepareCreateResourceLink(db, { actor: { id: 'a', organizationId: 'o', role: 'ADMIN' }, ...valid }), e => e.statusCode === 403);
});
import { randomUUID } from 'node:crypto';
import { createResourceLinkFakeDb } from '../helpers/resource-links-fake.js';
import { createResourceLink, updateResourceLink, archiveResourceLink, reorderResourceLinks, prepareUpdateResourceLink, updateResourceLinkInTransaction, prepareReorderResourceLinks, reorderResourceLinksInTransaction, listResourceLinks, listClientResourceLinks } from '../../services/resource-links.service.js';
const actor = { id: 'staff', organizationId: 'org' };
const create = (db, fields = {}) => createResourceLink(db, { actor, ...valid, createIntentId: randomUUID(), ...fields });
test('duplicate exact URLs stay distinct; exact intent retry yields one row and changed payload conflicts', async () => {
    const db = createResourceLinkFakeDb();
    const intent = randomUUID();
    const first = await create(db, { createIntentId: intent, entityId: 'project' });
    const second = await create(db, { entityId: 'project' });
    assert.notEqual(first.id, second.id);
    assert.equal((await create(db, { createIntentId: intent, entityId: 'project' })).id, first.id);
    assert.equal(db.state.rows.length, 2);
    assert.equal(db.state.audit.length, 2);
    await assert.rejects(create(db, { createIntentId: intent, entityId: 'project', title: 'Changed' }), e => e.statusCode === 409);
});
test('owner/admin mutations CAS archive restore and audit', async () => {
    const db = createResourceLinkFakeDb();
    let row = await create(db, { entityId: 'project' });
    await assert.rejects(updateResourceLink(db, { actor: { id: 'other', organizationId: 'org' }, id: row.id, expectedRevision: 1, title: 'No' }), e => e.statusCode === 403);
    row = await updateResourceLink(db, { actor, id: row.id, expectedRevision: 1, title: 'New' });
    assert.equal(row.revision, 2);
    await assert.rejects(updateResourceLink(db, { actor, id: row.id, expectedRevision: 1, title: 'Stale' }), e => e.statusCode === 409);
    row = await archiveResourceLink(db, { actor, id: row.id, expectedRevision: 2, archived: true });
    assert.equal((await listResourceLinks(db, { actor, entityType: 'PROJECT', entityId: 'project' })).items.length, 0);
    row = await archiveResourceLink(db, { actor: { id: 'admin', organizationId: 'org' }, id: row.id, expectedRevision: 3, archived: false });
    assert.equal(row.revision, 4);
    assert.equal(row.archivedAt, null);
    assert.equal(db.state.audit.length, 4);
});
test('complete reorder rejects omission, stale revisions and concurrent membership changes atomically', async () => {
    const db = createResourceLinkFakeDb();
    const a = await create(db, { entityId: 'project' });
    const b = await create(db, { entityId: 'project' });
    const base = { actor, entityType: 'PROJECT', entityId: 'project' };
    await assert.rejects(reorderResourceLinks(db, { ...base, ordered: [{ id: a.id, expectedRevision: 1 }] }), e => e.statusCode === 409);
    const prepared = await prepareReorderResourceLinks(db, { ...base, ordered: [{ id: b.id, expectedRevision: 1 }, { id: a.id, expectedRevision: 1 }] });
    await create(db, { entityId: 'project' });
    await assert.rejects(reorderResourceLinksInTransaction(db, prepared), e => e.statusCode === 409);
    assert.equal(db.state.rows[0].position, 0);
});
test('prepared edits recheck actor revocation and parent availability', async () => {
    const db = createResourceLinkFakeDb();
    const row = await create(db, { entityId: 'project' });
    const p = await prepareUpdateResourceLink(db, { actor, id: row.id, expectedRevision: 1, title: 'Changed' });
    db.state.users[0].isActive = false;
    await assert.rejects(updateResourceLinkInTransaction(db, p), e => e.statusCode === 403);
    db.state.users[0].isActive = true;
    db.state.projects[0].deletedAt = new Date();
    await assert.rejects(updateResourceLinkInTransaction(db, p), e => e.statusCode === 404);
});
test('shared task links follow live canonical project and minimal portal projection', async () => {
    const db = createResourceLinkFakeDb();
    await create(db, { entityType: 'TASK', entityId: 'task', clientVisible: true, source: { system: 'manual', recordId: '1', originalTitle: 'A', originalUrl: valid.url, originalCreatedAt: 'unknown exact text', originalPosition: 1 } });
    await create(db, { entityId: 'project' });
    let links = await listClientResourceLinks(db, { organizationId: 'org', clientId: 'client', projectId: 'project' });
    assert.equal(links.items.length, 1);
    assert.deepEqual(Object.keys(links.items[0]), ['id', 'title', 'url', 'position', 'updatedAt']);
    db.state.tasks[0].deletedAt = new Date();
    links = await listClientResourceLinks(db, { organizationId: 'org', clientId: 'client', projectId: 'project' });
    assert.equal(links.items.length, 0);
    await assert.rejects(listClientResourceLinks(db, { organizationId: 'else', clientId: 'client', projectId: 'project' }), e => e.statusCode === 404);
});
test('source exact strings survive edits and no outbound fetch occurs', async () => {
    const db = createResourceLinkFakeDb();
    const source = { system: 'fluentboards', recordId: '158', originalTitle: 'Original title', originalUrl: valid.url, originalCreatedAt: '2025-01-01 09:10:11+00:00', originalPosition: 9 };
    const previous = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw Error('Unexpected outbound request'); };
    try {
        let row = await create(db, { entityId: 'project', source });
        row = await updateResourceLink(db, { actor, id: row.id, expectedRevision: 1, title: 'Edited title' });
        assert.deepEqual(row.source, source);
        assert.equal(calls, 0);
    }
    finally {
        globalThis.fetch = previous;
    }
});
test('active cap does not count archived rows but blocks restores into full targets', async () => {
    const db = createResourceLinkFakeDb();
    const first = await create(db, { entityId: 'project' });
    await archiveResourceLink(db, { actor, id: first.id, expectedRevision: 1, archived: true });
    for (let i = 0; i < 500; i++)
        db.state.rows.push({ ...db.state.rows[0], id: `seed-${i}`, archivedAt: null, position: i });
    await assert.rejects(create(db, { entityId: 'project' }), e => e.statusCode === 409);
    await assert.rejects(archiveResourceLink(db, { actor, id: first.id, expectedRevision: 2, archived: false }), e => e.statusCode === 409);
});
import Fastify from 'fastify';
import resourceLinkRoutes from '../../routes/resource-links.routes.js';
test('HTTP routes validate exact contracts and reject client access', async () => {
    const db = createResourceLinkFakeDb();
    db.state.users.push({ id: 'client-user', organizationId: 'org', role: 'CLIENT', isActive: true });
    const app = Fastify();
    app.decorate('authenticate', async (request) => { request.user = { id: request.headers['x-actor'] ?? 'staff', organizationId: 'org' }; request.prisma = db; });
    await app.register(resourceLinkRoutes, { prefix: '/api/resource-links' });
    try {
        const payload = { ...valid, entityId: 'project' };
        let response = await app.inject({ method: 'POST', url: '/api/resource-links', payload });
        assert.equal(response.statusCode, 201, response.body);
        const row = response.json();
        response = await app.inject({ method: 'GET', url: '/api/resource-links?entityType=PROJECT&entityId=project&includeArchived=false&limit=1' });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().items.length, 1);
        response = await app.inject({ method: 'PATCH', url: `/api/resource-links/${row.id}`, payload: { expectedRevision: 1, projectId: 'forged' } });
        assert.equal(response.statusCode, 400);
        response = await app.inject({ method: 'GET', url: `/api/resource-links/${row.id}`, headers: { 'x-actor': 'client-user' } });
        assert.equal(response.statusCode, 403);
        response = await app.inject({ method: 'POST', url: '/api/resource-links/reorder', payload: { entityType: 'PROJECT', entityId: 'project', ordered: [{ id: row.id, expectedRevision: 1 }] } });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().items[0].revision, 2);
    }
    finally {
        await app.close();
    }
});
test('task reparent drift fails closed independently of database foreign keys', async () => {
    const db = createResourceLinkFakeDb();
    const row = await create(db, { entityType: 'TASK', entityId: 'task' });
    db.state.projects.push({ id: 'other-project', organizationId: 'org', clientId: 'client' });
    db.state.tasks[0].projectId = 'other-project';
    await assert.rejects(prepareUpdateResourceLink(db, { actor, id: row.id, expectedRevision: 1, title: 'Drifted' }), e => e.statusCode === 404);
});
