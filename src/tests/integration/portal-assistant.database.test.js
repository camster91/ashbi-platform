import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { updatePortalAssistantConfig, listPortalAssistant, createPortalAssistantIntent, readPortalAssistantRun, dispatchPortalAssistantRun, terminatePortalAssistantRun } from '../../services/portal-assistant.service.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
const options = { skip: !url && 'Disposable PostgreSQL not configured', timeout: 120000 };
const input = () => ({ message: 'Synthetic portal question', idempotencyKey: randomUUID() });
async function fixture(work) {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const db = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 8 }) });
  const org = `portal-ai-${randomUUID()}`, otherOrg = `${org}-foreign`;
  try {
    for (const id of [org, otherOrg]) await db.organization.create({ data: { id, slug: id, name: 'Portal assistant fixture' } });
    const client = await db.client.create({ data: { organizationId: org, name: 'Portal client' } });
    const foreign = await db.client.create({ data: { organizationId: otherOrg, name: 'Foreign client' } });
    const project = await db.project.create({ data: { organizationId: org, clientId: client.id, name: 'Portal project' } });
    const foreignProject = await db.project.create({ data: { organizationId: otherOrg, clientId: foreign.id, name: 'Foreign project' } });
    const people = [];
    for (const role of ['CLIENT', 'CLIENT', 'ADMIN', 'TEAM']) {
      const person = await db.user.create({ data: { organizationId: org, email: `${randomUUID()}@example.invalid`, name: role, password: randomUUID(), role, ...(role === 'CLIENT' ? { clientId: client.id } : {}) } });
      const contact = role === 'CLIENT' ? await db.contact.create({ data: { clientId: client.id, email: person.email, name: role } }) : null;
      people.push({ ...person, ...(contact ? { contactId: contact.id, typ: 'client_session' } : { typ: 'session' }) });
    }
    const [a, b, admin, team] = people;
    await updatePortalAssistantConfig(db, admin, client.id, { revision: 0, enabled: true, name: 'Client-published helper', instructions: 'Only confirmed facts.' });
    const create = (fields = input(), person = a) => createPortalAssistantIntent(db, person, project.id, fields);
    const dispatch = (run, chat, extra = {}) => dispatchPortalAssistantRun(db, a, project.id, run.id, { chat, ...extra });
    await work({ db, org, client, project, foreignProject, a, b, admin, team, create, dispatch });
  } finally {
    const ids = [org, otherOrg];
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      for (const table of ['portal_assistant_runs', 'portal_assistant_conversations', 'portal_assistant_configs']) await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "organizationId" = ANY($1::text[])`, ids);
    });
    if (await purgeFixtureAuditEvents(db, { ids })) {
      await db.project.deleteMany({ where: { organizationId: { in: ids } } });
      await db.contact.deleteMany({ where: { client: { organizationId: { in: ids } } } });
      await db.user.deleteMany({ where: { organizationId: { in: ids } } });
      await db.client.deleteMany({ where: { organizationId: { in: ids } } });
      await db.organization.deleteMany({ where: { id: { in: ids } } });
    }
    await db.$disconnect();
  }
}
test('migrated portal assistant enforces private audience, immutable intent and one claimant', options, async () => fixture(async f => {
  const { db, a, b, team, project, foreignProject, create, dispatch } = f, fields = input();
  const concurrent = await Promise.allSettled([create(fields), create(fields)]);
  assert.ok(concurrent.some(row => row.status === 'fulfilled'));
  assert.equal(await db.portalAssistantRun.count({ where: { organizationId: f.org } }), 1);
  const run = (await readPortalAssistantRun(db, a, project.id, { idempotencyKey: fields.idempotencyKey })).run;
  assert.equal((await create(fields)).run.id, run.id);
  for (const selector of [{ runId: run.id }, { idempotencyKey: fields.idempotencyKey }]) await assert.rejects(readPortalAssistantRun(db, b, project.id, selector), { statusCode: 404 });
  assert.equal((await listPortalAssistant(db, b, project.id)).items.length, 0);
  await assert.rejects(listPortalAssistant(db, b, project.id, { after: run.id }), { statusCode: 404 });
  await assert.rejects(createPortalAssistantIntent(db, a, foreignProject.id, input()), { statusCode: 404 });
  await assert.rejects(createPortalAssistantIntent(db, team, project.id, input()), { statusCode: 401 });
  await assert.rejects(db.portalAssistantRun.update({ where: { id: run.id }, data: { message: 'Changed' } }));
  await assert.rejects(db.portalAssistantRun.update({ where: { id: run.id }, data: { contactId: b.contactId } }));
  await assert.rejects(db.portalAssistantConversation.updateMany({ where: { organizationId: f.org }, data: { userId: b.id } }));
  await assert.rejects(db.portalAssistantRun.update({ where: { id: run.id }, data: {
    status: 'RUNNING', claimToken: randomUUID(), startedAt: new Date(),
    contextSnapshot: { observedAt: new Date().toISOString(), client: { id: f.client.id, name: f.client.name }, project: { id: project.id, name: project.name, status: project.status, startDate: null, endDate: null }, hiddenStaffBody: 'Never permitted' }, memorySnapshot: [],
  } }));
  let release, entered, calls = 0;
  const start = new Promise(r => { entered = r; }), hold = new Promise(r => { release = r; });
  const first = dispatch(run, async () => { calls++;entered();return hold; });
  await start;
  const second = await dispatch(run, async () => { calls++;return 'Second must not happen'; });
  assert.equal(second.run.status, 'RUNNING');assert.equal(calls, 1);
  release('Confirmed project identity only');
  assert.equal((await first).run.status, 'SUCCEEDED');
  await assert.rejects(db.portalAssistantRun.update({ where: { id: run.id }, data: { response: 'Rewrite terminal result' } }));
  await assert.rejects(db.portalAssistantRun.delete({ where: { id: run.id } }));
  assert.equal((await dispatch(run, async () => { calls++;return 'No'; })).run.status, 'SUCCEEDED');assert.equal(calls, 1);
}));

test('real PG abandoned queued/running intents expire by explicit recovery without a second dispatch', options, async () => fixture(async f => {
  // Shorten only the newly inserted fixture deadline. Immutable origin and
  // the production SQL <=61-second bound remain enforced by the real DB.
  const short = new Proxy(f.db, { get(target, key) {
    if (key === '$transaction') return (work, opts) => target.$transaction(tx => work(new Proxy(tx, { get(db, prop) {
      if (prop === 'portalAssistantRun') return new Proxy(db[prop], { get(model, method) {
        if (method === 'create') return args => model.create({ ...args, data: { ...args.data, deadlineAt: new Date(Date.now() + 350) } });
        const value = model[method];return typeof value === 'function' ? value.bind(model) : value;
      } });
      const value = db[prop];return typeof value === 'function' ? value.bind(db) : value;
    } })), opts);
    const value = target[key];return typeof value === 'function' ? value.bind(target) : value;
  } });
  const queued = (await createPortalAssistantIntent(short, f.a, f.project.id, input())).run;
  await new Promise(r => setTimeout(r, Math.max(1, +new Date(queued.deadlineAt) - Date.now() + 30)));
  let calls = 0;
  assert.equal((await f.dispatch(queued, async () => { calls++;return 'No'; })).run.status, 'EXPIRED');
  const running = (await createPortalAssistantIntent(short, f.a, f.project.id, input())).run;
  await f.db.portalAssistantRun.update({ where: { id: running.id }, data: {
    status: 'RUNNING', claimToken: randomUUID(), startedAt: new Date(),
    contextSnapshot: { observedAt: new Date().toISOString(), client: { id: f.client.id, name: f.client.name }, project: { id: f.project.id, name: f.project.name, status: f.project.status, startDate: null, endDate: null } }, memorySnapshot: [],
  } });
  await assert.rejects(terminatePortalAssistantRun(f.db, f.a, f.project.id, running.id, 'recover'), { statusCode: 409 });
  await new Promise(r => setTimeout(r, Math.max(1, +new Date(running.deadlineAt) - Date.now() + 30)));
  assert.equal((await terminatePortalAssistantRun(f.db, f.a, f.project.id, running.id, 'recover')).run.status, 'UNKNOWN');
  assert.equal((await f.dispatch(running, async () => { calls++;return 'Never repeat unknown'; })).run.status, 'UNKNOWN');assert.equal(calls, 0);
}));

for (const revoke of ['session', 'user', 'contact', 'client', 'project', 'config']) test(`real PG ${revoke} revocation during upstream await discards output`, options, async () => fixture(async f => {
  const run = (await f.create()).run;
  await assert.rejects(f.dispatch(run, async () => {
    if (revoke === 'session') await f.db.user.update({ where: { id: f.a.id }, data: { sessionVersion: { increment: 1 } } });
    if (revoke === 'user') await f.db.user.update({ where: { id: f.a.id }, data: { isActive: false } });
    if (revoke === 'contact') await f.db.contact.delete({ where: { id: f.a.contactId } });
    if (revoke === 'client') await f.db.client.update({ where: { id: f.client.id }, data: { status: 'PAUSED' } });
    if (revoke === 'project') {
      const replacement = await f.db.client.create({ data: { organizationId: f.org, name: 'Replacement' } });
      await f.db.project.update({ where: { id: f.project.id }, data: { clientId: replacement.id } });
    }
    if (revoke === 'config') await updatePortalAssistantConfig(f.db, f.admin, f.client.id, { revision: 1, enabled: false, name: 'Paused', instructions: '' });
    return 'Do not publish after authority changed';
  }), { statusCode: 409 });
  const stored = await f.db.portalAssistantRun.findUnique({ where: { id: run.id } });
  assert.equal(stored.status, 'DISCARDED');assert.equal(stored.response, null);
}));

test('real PG cancellation/deadline and audit rollback retain durable single-attempt semantics', options, async () => fixture(async f => {
  const cancelled = (await f.create()).run;
  assert.equal((await f.dispatch(cancelled, async () => {
    await terminatePortalAssistantRun(f.db, f.a, f.project.id, cancelled.id, 'cancel');return 'Late output';
  })).run.status, 'CANCELLED');
  const deadline = (await f.create()).run;
  assert.equal((await f.dispatch(deadline, () => new Promise(() => {}), { timeoutMs: 10 })).run.status, 'UNKNOWN');
  let calls = 0;
  await f.dispatch(deadline, async () => { calls++;return 'Never retry'; });assert.equal(calls, 0);
  const pending = (await f.create()).run;
  const broken = new Proxy(f.db, { get(target, key) {
    if (key === '$transaction') return (work, options) => target.$transaction(tx => work(new Proxy(tx, { get(db, prop) {
      if (prop === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit unavailable'); } };
      const value = db[prop];return typeof value === 'function' ? value.bind(db) : value;
    } })), options);
    const value = target[key];return typeof value === 'function' ? value.bind(target) : value;
  } });
  await assert.rejects(dispatchPortalAssistantRun(broken, f.a, f.project.id, pending.id, { chat: async () => { calls++;return 'No'; } }), { statusCode: 503 });
  assert.equal(calls, 0);assert.equal((await f.db.portalAssistantRun.findUnique({ where: { id: pending.id } })).status, 'QUEUED');
}));

for (const parent of ['user', 'config']) test(`real PG ${parent} revocation races after settlement authority read: parent locks linearize publication`, options, async () => fixture(async f => {
  const run = (await f.create()).run;
  let phase = 0, ready, release, writerPid;
  const reached = new Promise(r => { ready = r; }), hold = new Promise(r => { release = r; });
  const observed = new Proxy(f.db, { get(target, key) {
    if (key === '$transaction') return (work, opts) => target.$transaction(tx => {
      const settlement = ++phase === 2;
      return work(new Proxy(tx, { get(db, prop) {
        if (settlement && prop === 'portalAssistantConfig') return new Proxy(db[prop], { get(model, method) {
          if (method === 'findFirst') return async args => { const row = await model.findFirst(args);ready();await hold;return row; };
          const value = model[method];return typeof value === 'function' ? value.bind(model) : value;
        } });
        const value = db[prop];return typeof value === 'function' ? value.bind(db) : value;
      } }));
    }, { ...opts, timeout: 20000 });
    const value = target[key];return typeof value === 'function' ? value.bind(target) : value;
  } });
  const dispatch = dispatchPortalAssistantRun(observed, f.a, f.project.id, run.id, { chat: async () => 'Publish before a concurrent later revocation' });
  let writer;
  try {
    await reached;
    writer = f.db.$transaction(async tx => {
      writerPid = (await tx.$queryRaw`SELECT pg_backend_pid() AS pid`)[0].pid;
      if (parent === 'user') await tx.user.update({ where: { id: f.a.id }, data: { isActive: false } });
      else await tx.portalAssistantConfig.updateMany({ where: { organizationId: f.org, clientId: f.client.id }, data: { enabled: false, revision: { increment: 1 }, changedById: f.admin.id } });
    }, { timeout: 20000 });
    let locked = false;
    for (let i = 0; i < 100 && !locked; i++) {
      if (writerPid) locked = (await f.db.$queryRaw`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${writerPid}`)[0]?.wait_event_type === 'Lock';
      if (!locked) await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(locked, true, 'Concurrent parent writer must wait on settlement FOR SHARE');
  } finally { release(); }
  // The readback may race the now-unblocked revocation, so the durable row is
  // the authoritative publication result; no stale portal response is required.
  await Promise.allSettled([dispatch, writer]);
  const stored = await f.db.portalAssistantRun.findUnique({ where: { id: run.id } });
  assert.equal(stored.status, 'SUCCEEDED');assert.equal(stored.response, 'Publish before a concurrent later revocation');
  if (parent === 'user') assert.equal((await f.db.user.findUnique({ where: { id: f.a.id } })).isActive, false);
  else assert.equal((await f.db.portalAssistantConfig.findFirst({ where: { organizationId: f.org } })).enabled, false);
}));
