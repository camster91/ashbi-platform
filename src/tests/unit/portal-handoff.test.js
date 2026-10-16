import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import staffHandoffRoutes from '../../routes/portal-handoff.routes.js';
import { createPortalHandoff, listPortalHandoffs, readPortalHandoff, listStaffHandoffs, readStaffHandoff, transitionHandoff } from '../../services/portal-handoff.service.js';
import { buildWorkQueue, WORK_QUEUE_SOURCES } from '../../services/work-queue.service.js';
import { handoffFixture } from '../helpers/portal-handoff-fixture.js';
const input = () => ({ question: 'Please arrange a human follow-up.', idempotencyKey: randomUUID() });
const create = (f, fields = input(), key = 'a') => createPortalHandoff(f.db, f.claims(key), 'project', fields);

test('creation, exact replay and safe principal projection persist once without AI/staff fields', async () => {
  const f = handoffFixture(), fields = input(), first = await create(f, fields);
  assert.deepEqual(Object.keys(first.request).sort(), ['id', 'projectId', 'question', 'status', 'createdAt', 'updatedAt'].sort());
  assert.equal((await create(f, fields)).idempotent, true);assert.equal(f.state.portalHandoffRequest.length, 1);assert.equal(f.state.auditEvent.length, 1);
  assert.doesNotMatch(JSON.stringify(f.state.auditEvent[0]), /Please arrange/);
  await assert.rejects(create(f, { ...fields, question: 'Different' }), { statusCode: 409 });
  await assert.rejects(createPortalHandoff(f.db, f.claims('a'), 'project-2', fields), { statusCode: 409 });
  assert.equal((await readPortalHandoff(f.db, f.claims('a'), 'project', { idempotencyKey: fields.idempotencyKey })).request.id, first.request.id);
});
test('two principals in same client cannot read/recover/page through one another; identical opaque intent is audience-local', async () => {
  const f = handoffFixture(), fields = input(), first = await create(f, fields);
  await assert.rejects(readPortalHandoff(f.db, f.claims('b'), 'project', { requestId: first.request.id }), { statusCode: 404 });
  await assert.rejects(readPortalHandoff(f.db, f.claims('b'), 'project', { idempotencyKey: fields.idempotencyKey }), { statusCode: 404 });
  assert.deepEqual(await listPortalHandoffs(f.db, f.claims('b'), 'project'), { items: [], nextCursor: null });
  await assert.rejects(listPortalHandoffs(f.db, f.claims('b'), 'project', { after: first.request.id }), { statusCode: 404 });
  assert.notEqual((await create(f, fields, 'b')).request.id, first.request.id);
});
test('revoked old session denies, legitimate new same-principal session retains history; replacement contact never inherits it', async () => {
  const f = handoffFixture(), claims = f.claims('a'), record = await create(f);
  f.state.user[0].sessionVersion++;
  await assert.rejects(listPortalHandoffs(f.db, claims, 'project'), { statusCode: 401 });
  assert.equal((await listPortalHandoffs(f.db, f.claims('a'), 'project')).items.length, 1);
  f.state.contact[0].id = 'replacement';
  await assert.rejects(readPortalHandoff(f.db, f.claims('a'), 'project', { requestId: record.request.id }), { statusCode: 401 });
  const replacement = { ...f.claims('a'), contactId: 'replacement' };
  assert.equal((await listPortalHandoffs(f.db, replacement, 'project')).items.length, 0);
  await assert.rejects(readPortalHandoff(f.db, replacement, 'project', { requestId: record.request.id }), { statusCode: 404 });
});
for (const [name, revoke] of [
  ['inactive principal', f => { f.state.user[0].isActive = false; }],
  ['demoted/moved principal', f => { f.state.user[0].organizationId = 'foreign'; }],
  ['contact removed', f => { f.state.contact.splice(0, 1); }],
  ['paused client', f => { f.state.client[0].status = 'PAUSED'; }],
  ['archived client', f => { f.state.client[0].relationshipStatus = 'ARCHIVED'; }],
]) test(`${name} denies fresh portal reads and replay`, async () => {
  const f = handoffFixture(), fields = input(), claims = f.claims('a');await create(f, fields);revoke(f);
  await assert.rejects(createPortalHandoff(f.db, claims, 'project', fields), { statusCode: 401 });
  await assert.rejects(listPortalHandoffs(f.db, claims, 'project'), { statusCode: 401 });
});
test('canonical project remap/trash denies even retained receipt and staff access', async () => {
  const f = handoffFixture(), record = await create(f);f.state.project[0].clientId = 'wrong';
  await assert.rejects(readPortalHandoff(f.db, f.claims('a'), 'project', { requestId: record.request.id }), { statusCode: 404 });
  await assert.rejects(readStaffHandoff(f.db, f.staff('admin'), record.request.id), { statusCode: 404 });
  await assert.rejects(transitionHandoff(f.db, f.staff('admin'), record.request.id, 'claim', { revision: 1 }), { statusCode: 404 });
  assert.equal((await listStaffHandoffs(f.db, f.staff('admin'))).items.length, 0);
  f.state.project[0].clientId = 'client';f.state.project[0].deletedAt = new Date();
  assert.equal((await listStaffHandoffs(f.db, f.staff('admin'))).items.length, 0);
});
test('client and staff paging bind cursors to the current audience/filters before limit', async () => {
  const f = handoffFixture();
  for (let index = 0; index < 3; index++) await create(f);
  const foreign = await create(f, input(), 'b');
  const first = await listPortalHandoffs(f.db, f.claims('a'), 'project', { limit: 1 });
  assert.equal(first.items.length, 1);assert.ok(first.nextCursor);
  const next = await listPortalHandoffs(f.db, f.claims('a'), 'project', { limit: 1, after: first.nextCursor });
  assert.equal(next.items.length, 1);assert.notEqual(first.items[0].id, next.items[0].id);
  await assert.rejects(listPortalHandoffs(f.db, f.claims('a'), 'project', { after: foreign.request.id }), { statusCode: 404 });
  const staff = await listStaffHandoffs(f.db, f.staff('admin'), { limit: 1 });assert.equal(staff.items.length, 1);assert.ok(staff.nextCursor);
  await assert.rejects(listStaffHandoffs(f.db, f.staff('admin'), { clientId: 'wrong', after: staff.nextCursor }), { statusCode: 404 });
});
test('claim has exactly one owner, resolve requires owner/admin and CAS, terminal status cannot reopen', async () => {
  const f = handoffFixture(), record = await create(f), id = record.request.id;
  const attempts = await Promise.allSettled(['team', 'other'].map(actor => transitionHandoff(f.db, f.staff(actor), id, 'claim', { revision: 1 })));
  assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
  const owner = f.state.portalHandoffRequest[0].ownerId, notOwner = owner === 'team' ? 'other' : 'team';
  await assert.rejects(transitionHandoff(f.db, f.staff(notOwner), id, 'resolve', { revision: 2 }), { statusCode: 409 });
  await assert.rejects(transitionHandoff(f.db, f.staff(owner), id, 'resolve', { revision: 1 }), { statusCode: 409 });
  assert.equal((await transitionHandoff(f.db, f.staff(owner), id, 'resolve', { revision: 2 })).request.status, 'RESOLVED');
  await assert.rejects(transitionHandoff(f.db, f.staff('admin'), id, 'requeue', { revision: 3, reason: 'RECOVERY' }), { statusCode: 409 });
  assert.equal((await listPortalHandoffs(f.db, f.claims('a'), 'project')).items[0].status, 'RESOLVED');
});
test('only current ADMIN may requeue a departed owner; fresh demotion and foreign organization deny', async () => {
  const f = handoffFixture(), record = await create(f), id = record.request.id;
  await transitionHandoff(f.db, f.staff('team'), id, 'claim', { revision: 1 });
  await assert.rejects(transitionHandoff(f.db, f.staff('admin'), id, 'requeue', { revision: 2, reason: 'OWNER_UNAVAILABLE' }), { statusCode: 409 });
  f.state.user.find(row => row.id === 'team').isActive = false;
  await assert.rejects(transitionHandoff(f.db, f.staff('other'), id, 'requeue', { revision: 2, reason: 'RECOVERY' }), { statusCode: 403 });
  await assert.rejects(transitionHandoff(f.db, f.staff('foreign'), id, 'resolve', { revision: 2 }), { statusCode: 404 });
  assert.equal((await transitionHandoff(f.db, f.staff('admin'), id, 'requeue', { revision: 2, reason: 'OWNER_UNAVAILABLE' })).request.status, 'PENDING');
  assert.equal(f.state.auditEvent.at(-1).metadata.reason, 'OWNER_UNAVAILABLE');
  const stale = f.staff('admin');f.state.user.find(row => row.id === 'admin').role = 'CLIENT';
  await assert.rejects(transitionHandoff(f.db, stale, id, 'claim', { revision: 3 }), { statusCode: 403 });
});
test('required audit failure rolls back creation and subsequent mutation', async () => {
  const f = handoffFixture();f.failAudit();await assert.rejects(create(f), { statusCode: 503 });assert.equal(f.state.portalHandoffRequest.length, 0);
  const g = handoffFixture(), record = await create(g);g.failAudit();await assert.rejects(transitionHandoff(g.db, g.staff('team'), record.request.id, 'claim', { revision: 1 }), { statusCode: 503 });assert.equal(g.state.portalHandoffRequest[0].status, 'PENDING');
});
test('bounded/plain inputs refuse empty/oversized messages and assignment/notes; explicit ADMIN recovery preserves audit', async () => {
  const f = handoffFixture();
  for (const fields of [{ ...input(), question: ' \n\t ' }, { ...input(), question: 'x'.repeat(2001) }, { ...input(), privateNotes: 'not supported' }]) await assert.rejects(create(f, fields), { statusCode: 400 });
  const record = await create(f);await transitionHandoff(f.db, f.staff('team'), record.request.id, 'claim', { revision: 1 });
  await transitionHandoff(f.db, f.staff('admin'), record.request.id, 'requeue', { revision: 2, reason: 'RECOVERY' });
  assert.equal(f.state.portalHandoffRequest[0].ownerId, null);assert.equal(f.state.auditEvent.at(-1).metadata.reason, 'RECOVERY');
  await assert.rejects(transitionHandoff(f.db, f.staff('admin'), record.request.id, 'claim', { revision: 2 }), { statusCode: 409 });
});
test('existing queue source is bounded, fresh-authorized, filtered, question-free and partial on source failure', async () => {
  const f = handoffFixture();await create(f);const source = WORK_QUEUE_SOURCES.find(row => row.key === 'portal_handoffs');
  const options = { user: f.staff('team'), filters: {}, sources: [source] };
  const queue = await buildWorkQueue(f.db, options);assert.equal(queue.rows.length, 1);assert.equal(queue.partial, false);assert.doesNotMatch(JSON.stringify(queue), /Please arrange/);
  assert.equal(f.calls.at(-1).take, 101);
  assert.equal((await buildWorkQueue(f.db, { ...options, filters: { clientId: 'foreign' } })).rows.length, 0);
  assert.equal((await buildWorkQueue(f.db, { ...options, filters: { owner: 'me' } })).rows.length, 0);
  assert.equal((await buildWorkQueue(f.db, { ...options, filters: { projectId: 'wrong' } })).rows.length, 0);
  assert.equal((await buildWorkQueue(f.db, { ...options, filters: { view: 'at_risk' } })).rows.length, 0);
  const base = f.state.portalHandoffRequest[0];
  for (let index = 0; index < 101; index++) f.state.portalHandoffRequest.push({ ...base, id: `bounded-${String(index).padStart(3, '0')}` });
  const capped = await buildWorkQueue(f.db, options);assert.equal(capped.rows.length, 100);assert.deepEqual(capped.truncatedSources, ['portal_handoffs']);
  f.state.user.find(row => row.id === 'team').isActive = false;
  const denied = await buildWorkQueue(f.db, options);assert.equal(denied.partial, true);assert.deepEqual(denied.failedSources, ['portal_handoffs']);assert.equal(denied.rows.length, 0);
});
test('real portal JWT/clientAuth routes bind own-principal recovery and reject stale/anonymous/staff tokens', async t => {
  const f = handoffFixture(), app = Fastify();await app.register(jwt, { secret: 'synthetic-portal-handoff-secret' });await app.register(cookie);
  app.decorate('prisma', f.db);app.addHook('preHandler', async req => { req.prisma = f.db; });
  await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });await app.ready();t.after(() => app.close());
  const url = '/api/client-portal/projects/project/account-manager-requests';
  const inject = (claims, suffix = '', method = 'GET', payload) => app.inject({ url: url + suffix, method, headers: { authorization: `Bearer ${app.jwt.sign(claims)}` }, payload });
  assert.equal((await app.inject(url)).statusCode, 401);
  assert.equal((await inject({ ...f.staff('admin'), typ: 'session' })).statusCode, 401);
  const fields = input(), created = await inject(f.claims('a'), '', 'POST', fields);assert.equal(created.statusCode, 200, created.body);
  const me = () => app.inject({ url: '/api/client-portal/me', headers: { authorization: `Bearer ${app.jwt.sign(f.claims('a'))}` } });
  const identity = await me();assert.equal(identity.statusCode, 200, identity.body);
  assert.deepEqual(identity.json().handoffIdentity, { organizationId: 'org', userId: 'client-a', contactId: 'contact-a' });
  assert.deepEqual(Object.keys(identity.json().handoffIdentity).sort(), ['contactId', 'organizationId', 'userId']);
  assert.equal((await inject(f.claims('b'), `/by-intent/${fields.idempotencyKey}`)).statusCode, 404);
  assert.equal((await inject(f.claims('b'))).json().items.length, 0);
  const old = f.claims('a');f.state.user[0].sessionVersion++;
  assert.equal((await inject(old)).statusCode, 401);assert.equal((await inject(f.claims('a'))).json().items.length, 1);
  assert.equal((await inject(f.claims('a'), '', 'POST', { ...input(), ownerId: 'admin' })).statusCode, 400);
  f.state.contact[0].id = 'replacement-contact';
  assert.equal((await me()).statusCode, 401);
  const replacement = await app.inject({ url: '/api/client-portal/me', headers: { authorization: `Bearer ${app.jwt.sign({ ...f.claims('a'), contactId: 'replacement-contact' })}` } });
  assert.equal(replacement.statusCode, 200, replacement.body);assert.equal(replacement.json().handoffIdentity.contactId, 'replacement-contact');
});
test('actual staff HTTP routes reject client principals and never accept arbitrary assignees', async t => {
  const f = handoffFixture(), record = await create(f), app = Fastify();
  app.decorate('authenticate', async req => { req.user = f.staff(req.headers['x-actor']) || f.claims('a');req.prisma = f.db; });
  await app.register(staffHandoffRoutes, { prefix: '/api/portal-handoffs' });await app.ready();t.after(() => app.close());
  const url = `/api/portal-handoffs/${record.request.id}/claim`;
  assert.equal((await app.inject({ url, method: 'POST', payload: { revision: 1 } })).statusCode, 403);
  assert.equal((await app.inject({ url, method: 'POST', headers: { 'x-actor': 'team' }, payload: { revision: 1, ownerId: 'other' } })).statusCode, 400);
  const response = await app.inject({ url, method: 'POST', headers: { 'x-actor': 'team' }, payload: { revision: 1 } });assert.equal(response.statusCode, 200, response.body);assert.equal(response.json().request.ownerId, 'team');
});
