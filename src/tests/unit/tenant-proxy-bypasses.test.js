// M2 (security audit at 8687cf9): the tenant proxy failed open. Unlisted
// delegate methods passed through unscoped, and relation-scoped writes only
// checked `${path[0]}Id`, so a foreign assigneeId / dependsOnId, a nested
// `connect` to another organization's record, or an owner change through
// updateMany were written unchecked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createScopedPrisma, SCOPED_DELEGATE_METHODS } from '../../utils/prisma-tenant-proxy.js';
import { tenantRelationMap } from '../../utils/tenant-relations.js';

// A fake database: records per delegate with an organization, relation-scoped
// ownership resolved by the fake's findFirst (only org-a rows exist as "own").
const OWN = new Set(['user-a', 'task-a', 'task-a2', 'project-a', 'client-a', 'milestone-a', 'thread-a']);

function fakeDb() {
  const writes = [];
  const delegate = (name) => ({
    findFirst: async ({ where }) => {
      const json = JSON.stringify(where);
      const id = [...OWN].find((candidate) => json.includes(`"${candidate}"`));
      return id && json.includes('org-a') ? { id } : null;
    },
    findMany: async (args) => { writes.push([name, 'findMany', args]); return []; },
    findFirstOrThrow: async (args) => { writes.push([name, 'findFirstOrThrow', args]); return {}; },
    create: async (args) => { writes.push([name, 'create', args]); return { id: 'new' }; },
    createMany: async (args) => { writes.push([name, 'createMany', args]); return { count: 1 }; },
    createManyAndReturn: async (args) => { writes.push([name, 'createManyAndReturn', args]); return []; },
    update: async (args) => { writes.push([name, 'update', args]); return { id: 'x' }; },
    updateMany: async (args) => { writes.push([name, 'updateMany', args]); return { count: 1 }; },
    updateManyAndReturn: async (args) => { writes.push([name, 'updateManyAndReturn', args]); return []; },
    // Methods a scoped client must never reach.
    findRaw: async () => { writes.push([name, 'findRaw']); return []; },
    aggregateRaw: async () => { writes.push([name, 'aggregateRaw']); return []; },
    futureMethod: async () => { writes.push([name, 'futureMethod']); return []; },
  });
  return {
    writes,
    db: {
      task: delegate('task'), user: delegate('user'), project: delegate('project'),
      client: delegate('client'), milestone: delegate('milestone'), thread: delegate('thread'),
      invoice: delegate('invoice'),
    },
  };
}

const mutations = (writes) => writes.filter(([, method]) => !['findMany', 'findFirstOrThrow'].includes(method));

test('unlisted delegate methods are refused instead of running unscoped', async () => {
  const { db, writes } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  for (const method of ['findRaw', 'aggregateRaw', 'futureMethod']) {
    await assert.rejects(scoped.task[method]({}), /not permitted in request scope/, method);
  }
  assert.deepEqual(writes, []);
});

test('findFirstOrThrow on a relation-scoped model is tenant-filtered', async () => {
  const { db, writes } = fakeDb();
  await createScopedPrisma(db, 'org-a').task.findFirstOrThrow({ where: { id: 'task-b' } });
  assert.deepEqual(writes[0][2].where.AND, [{ id: 'task-b' }, { project: { client: { organizationId: 'org-a' } } }]);
});

test('updateManyAndReturn and createManyAndReturn are scoped and ownership-checked', async () => {
  const { db, writes } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  await scoped.task.updateManyAndReturn({ where: { status: 'OPEN' }, data: { status: 'DONE' } });
  assert.deepEqual(writes[0][2].where.AND, [{ status: 'OPEN' }, { project: { client: { organizationId: 'org-a' } } }]);
  await assert.rejects(
    scoped.task.createManyAndReturn({ data: [{ projectId: 'project-b', title: 'x' }] }),
    /does not belong to organization org-a/,
  );
  await assert.rejects(
    scoped.task.updateManyAndReturn({ where: {}, data: { projectId: 'project-b' } }),
    /does not belong to organization org-a/,
  );
});

test('a foreign assigneeId or dependsOnId is refused on create and update', async () => {
  const { db, writes } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  await assert.rejects(scoped.task.create({ data: { projectId: 'project-a', title: 't', assigneeId: 'user-b' } }), /assignee user-b does not belong/);
  await assert.rejects(scoped.task.create({ data: { projectId: 'project-a', title: 't', dependsOnId: 'task-b' } }), /dependsOn task-b does not belong/);
  await assert.rejects(scoped.task.update({ where: { id: 'task-a' }, data: { assigneeId: 'user-b' } }), /assignee user-b/);
  await assert.rejects(scoped.task.update({ where: { id: 'task-a' }, data: { dependsOnId: { set: 'task-b' } } }), /dependsOn task-b/);
  await assert.rejects(scoped.task.updateMany({ where: {}, data: { milestoneId: 'milestone-b' } }), /milestone milestone-b/);
  assert.deepEqual(mutations(writes), []);

  await scoped.task.update({ where: { id: 'task-a' }, data: { assigneeId: 'user-a', dependsOnId: 'task-a2' } });
  assert.equal(mutations(writes).length, 1);
});

test('nested connect, set and connectOrCreate to foreign records are refused', async () => {
  const { db, writes } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  await assert.rejects(scoped.task.update({ where: { id: 'task-a' }, data: { assignee: { connect: { id: 'user-b' } } } }), /assignee user-b/);
  await assert.rejects(scoped.task.update({ where: { id: 'task-a' }, data: { dependsOn: { connect: { id: 'task-b' } } } }), /dependsOn task-b/);
  await assert.rejects(scoped.project.update({ where: { id: 'project-a' }, data: { tasks: { connect: [{ id: 'task-b' }] } } }), /tasks task-b/);
  await assert.rejects(scoped.project.update({ where: { id: 'project-a' }, data: { tasks: { set: [{ id: 'task-b' }] } } }), /tasks task-b/);
  await assert.rejects(
    scoped.task.update({ where: { id: 'task-a' }, data: { assignee: { connectOrCreate: { where: { id: 'user-b' }, create: {} } } } }),
    /not allowed in scoped writes/,
  );
  await assert.rejects(
    scoped.task.update({ where: { id: 'task-a' }, data: { project: { create: { name: 'p', clientId: 'client-b' } } } }),
    /not allowed in scoped writes/,
  );
  assert.deepEqual(mutations(writes), []);
});

test('nested creates are validated recursively and get the organization', async () => {
  const { db, writes } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  await assert.rejects(
    scoped.project.create({ data: { name: 'p', clientId: 'client-a', tasks: { create: [{ title: 't', assigneeId: 'user-b' }] } } }),
    /assignee user-b/,
  );
  await assert.rejects(
    scoped.project.update({ where: { id: 'project-a' }, data: { tasks: { createMany: { data: [{ title: 't', dependsOnId: 'task-b' }] } } } }),
    /dependsOn task-b/,
  );
  await assert.rejects(
    scoped.project.update({ where: { id: 'project-a' }, data: { tasks: { update: { where: { id: 'task-a' }, data: { assigneeId: 'user-b' } } } } }),
    /assignee user-b/,
  );
  assert.deepEqual(mutations(writes), []);
});

test('a foreign organization reference is refused', async () => {
  const { db } = fakeDb();
  const scoped = createScopedPrisma(db, 'org-a');
  await assert.rejects(
    scoped.task.update({ where: { id: 'task-a' }, data: { project: { connect: { id: 'project-b' } } } }),
    /project project-b/,
  );
});

test('the allowlist covers every read and write the proxy scopes', () => {
  assert.deepEqual([...SCOPED_DELEGATE_METHODS].sort(), [
    'aggregate', 'count', 'create', 'createMany', 'createManyAndReturn', 'delete', 'deleteMany',
    'findFirst', 'findFirstOrThrow', 'findMany', 'findUnique', 'findUniqueOrThrow', 'groupBy',
    'update', 'updateMany', 'updateManyAndReturn', 'upsert',
  ]);
});

test('the runtime relation map matches every @relation(fields: [...]) in the schema', () => {
  const schema = readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const expected = new Set();
  let model = null;
  for (const line of schema.split('\n')) {
    const header = /^model (\w+) \{/.exec(line);
    if (header) { model = header[1].toLowerCase(); continue; }
    if (/^\}/.test(line)) { model = null; continue; }
    if (!model) continue;
    const field = /^\s*(\w+)\s+(\w+)\??\s+.*@relation\(([^)]*)\)/.exec(line);
    const fields = field && /fields:\s*\[([^\]]*)\]/.exec(field[3]);
    if (!fields) continue;
    const scalars = fields[1].split(',').map((name) => name.trim());
    assert.equal(scalars.length, 1, `${model}.${field[1]} uses a composite foreign key the proxy cannot verify`);
    expected.add(`${model}.${scalars[0]}->${field[1]}:${field[2].toLowerCase()}`);
  }
  const actual = new Set();
  for (const [key, meta] of tenantRelationMap()) {
    for (const [fk, relation] of Object.entries(meta.foreignKeys)) {
      actual.add(`${key}.${fk}->${relation}:${meta.relations[relation].target}`);
    }
  }
  assert.deepEqual([...actual].sort(), [...expected].sort());
});

test('PATCH /api/bot/task/:id accepts only validated task fields', async () => {
  const { botTaskUpdateSchema } = await import('../../validators/schemas.js');
  assert.equal(botTaskUpdateSchema.safeParse({ status: 'COMPLETED', title: 'Ship it' }).success, true);
  for (const body of [
    { projectId: 'project-b' },
    { dependsOnId: 'task-b' },
    { assignee: { connect: { id: 'user-b' } } },
    { project: { connect: { id: 'project-b' } } },
    { status: 'NOT_A_STATUS' },
  ]) {
    assert.equal(botTaskUpdateSchema.safeParse(body).success, false, JSON.stringify(body));
  }
  const source = readFileSync(new URL('../../routes/bot.routes.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /data:\s*request\.body/);
  assert.match(source, /fastify\.patch\('\/task\/:id', \{ preHandler: \[requireBotAuth, validateBody\(botTaskUpdateSchema\)\] \}/);
});

test('task routes check assignee and dependency ownership before writing', () => {
  const source = readFileSync(new URL('../../routes/task.routes.js', import.meta.url), 'utf8');
  assert.equal((source.match(/await taskReferenceProblem\(request\.prisma/g) || []).length, 3);
});
