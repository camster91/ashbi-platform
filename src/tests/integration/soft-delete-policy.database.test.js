import test from 'node:test';
import assert from 'node:assert/strict';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  SOFT_DELETE_MODELS,
  WITH_DELETED,
  withSoftDelete,
} from '../../services/soft-delete.service.js';

const { PrismaClient } = prismaPkg;
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('real database enforces one soft-delete policy across every classified model and operation', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const queries = [];
  const raw = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
    log: [{ emit: 'event', level: 'query' }],
  });
  raw.$on('query', ({ query }) => queries.push(query));
  const prisma = withSoftDelete(raw);
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ids = {};

  try {
    const organization = await raw.organization.create({
      data: { name: `Soft delete ${suffix}`, slug: `soft-delete-${suffix}` },
    });
    const user = await raw.user.create({
      data: {
        organizationId: organization.id,
        email: `soft-delete-${suffix}@example.test`,
        name: 'Soft Delete Test',
        password: 'not-a-real-password-hash',
      },
    });

    const activeClient = await raw.client.create({
      data: { organizationId: organization.id, name: `Active client ${suffix}` },
    });
    const deletedClient = await raw.client.create({
      data: { organizationId: organization.id, name: `Deleted client ${suffix}`, deletedAt: new Date() },
    });
    ids.client = [activeClient.id, deletedClient.id];

    const activeProject = await raw.project.create({
      data: { organizationId: organization.id, clientId: activeClient.id, name: `Active project ${suffix}` },
    });
    const deletedProject = await raw.project.create({
      data: { organizationId: organization.id, clientId: activeClient.id, name: `Deleted project ${suffix}`, deletedAt: new Date() },
    });
    ids.project = [activeProject.id, deletedProject.id];

    const seedPair = async (model, activeData, deletedData = activeData) => {
      const active = await raw[model].create({ data: activeData });
      const deleted = await raw[model].create({ data: { ...deletedData, deletedAt: new Date() } });
      ids[model] = [active.id, deleted.id];
    };

    await seedPair('task',
      { projectId: activeProject.id, title: `Active task ${suffix}` },
      { projectId: activeProject.id, title: `Deleted task ${suffix}` });
    await seedPair('note',
      { projectId: activeProject.id, authorId: user.id, title: `Active note ${suffix}`, content: 'active' },
      { projectId: activeProject.id, authorId: user.id, title: `Deleted note ${suffix}`, content: 'deleted' });
    await seedPair('timeEntry',
      { projectId: activeProject.id, userId: user.id, duration: 15, description: `Active time ${suffix}` },
      { projectId: activeProject.id, userId: user.id, duration: 30, description: `Deleted time ${suffix}` });

    const retainerClients = await Promise.all(['active', 'deleted'].map((kind) => raw.client.create({
      data: { organizationId: organization.id, name: `${kind} retainer client ${suffix}` },
    })));
    await seedPair('retainerPlan',
      { clientId: retainerClients[0].id, tier: '999', hoursPerMonth: 20 },
      { clientId: retainerClients[1].id, tier: '999', hoursPerMonth: 20 });
    await seedPair('proposal',
      { clientId: activeClient.id, projectId: activeProject.id, createdById: user.id, title: `Active proposal ${suffix}` },
      { clientId: activeClient.id, projectId: activeProject.id, createdById: user.id, title: `Deleted proposal ${suffix}` });
    await seedPair('contract',
      { clientId: activeClient.id, createdById: user.id, title: `Active contract ${suffix}`, content: 'active' },
      { clientId: activeClient.id, createdById: user.id, title: `Deleted contract ${suffix}`, content: 'deleted' });
    await seedPair('invoice',
      { clientId: activeClient.id, createdById: user.id, invoiceNumber: `ACTIVE-${suffix}` },
      { clientId: activeClient.id, createdById: user.id, invoiceNumber: `DELETED-${suffix}` });
    await seedPair('expense',
      { clientId: activeClient.id, projectId: activeProject.id, description: `Active expense ${suffix}`, amount: 10 },
      { clientId: activeClient.id, projectId: activeProject.id, description: `Deleted expense ${suffix}`, amount: 20 });
    await seedPair('estimate',
      { clientId: activeClient.id, title: `Active estimate ${suffix}` },
      { clientId: activeClient.id, title: `Deleted estimate ${suffix}` });

    assert.deepEqual(Object.keys(ids).sort(), [...SOFT_DELETE_MODELS].sort());
    queries.length = 0;

    const expectOnePolicyQuery = async (label, operation) => {
      const before = queries.length;
      const result = await operation();
      const emitted = queries.slice(before);
      assert.equal(emitted.length, 1, `${label} should emit exactly one SQL statement`);
      const predicates = emitted[0].match(/"deletedAt"\s+IS\s+NULL/gi) ?? [];
      assert.equal(predicates.length, 1, `${label} should apply deletedAt IS NULL exactly once`);
      return result;
    };

    for (const model of SOFT_DELETE_MODELS) {
      const [activeId, deletedId] = ids[model];
      const delegate = prisma[model];
      const active = await expectOnePolicyQuery(`${model}.findFirst`, () => delegate.findFirst({ where: { id: activeId } }));
      assert.equal(active.id, activeId);
      assert.equal(await expectOnePolicyQuery(`${model}.findFirst(deleted)`, () => delegate.findFirst({ where: { id: deletedId } })), null);
      assert.equal((await expectOnePolicyQuery(`${model}.findFirstOrThrow`, () => delegate.findFirstOrThrow({ where: { id: activeId } }))).id, activeId);
      assert.equal((await expectOnePolicyQuery(`${model}.findUnique`, () => delegate.findUnique({ where: { id: activeId } }))).id, activeId);
      assert.equal(await expectOnePolicyQuery(`${model}.findUnique(deleted)`, () => delegate.findUnique({ where: { id: deletedId } })), null);
      assert.equal((await expectOnePolicyQuery(`${model}.findUniqueOrThrow`, () => delegate.findUniqueOrThrow({ where: { id: activeId } }))).id, activeId);
      assert.deepEqual((await expectOnePolicyQuery(`${model}.findMany`, () => delegate.findMany({ where: { id: { in: [activeId, deletedId] } } }))).map(({ id }) => id), [activeId]);
      assert.equal(await expectOnePolicyQuery(`${model}.count`, () => delegate.count({ where: { id: { in: [activeId, deletedId] } } })), 1);
      assert.equal((await expectOnePolicyQuery(`${model}.aggregate`, () => delegate.aggregate({ where: { id: { in: [activeId, deletedId] } }, _count: { _all: true } })))._count._all, 1);
      const groups = await expectOnePolicyQuery(`${model}.groupBy`, () => delegate.groupBy({
        by: ['deletedAt'],
        where: { id: { in: [activeId, deletedId] } },
        _count: { _all: true },
      }));
      assert.equal(groups.length, 1);
      assert.equal(groups[0].deletedAt, null);
      assert.equal(groups[0]._count._all, 1);

      await delegate.delete({ where: { id: activeId } });
      assert.equal(await delegate.count({ where: { id: activeId } }), 0);
      await prisma[WITH_DELETED]()[model].update({ where: { id: activeId }, data: { deletedAt: null } });
      assert.equal(await delegate.count({ where: { id: activeId } }), 1);
      await delegate.deleteMany({ where: { id: activeId } });
      assert.equal(await delegate.count({ where: { id: activeId } }), 0);
      await prisma[WITH_DELETED]()[model].update({ where: { id: activeId }, data: { deletedAt: null } });
    }
  } finally {
    if (raw) {
      const deleteIds = async (model) => ids[model]?.length && raw[model].deleteMany({ where: { id: { in: ids[model] } } });
      for (const model of ['timeEntry', 'note', 'task', 'expense', 'estimate', 'invoice', 'contract', 'proposal', 'retainerPlan']) {
        await deleteIds(model);
      }
      await deleteIds('project');
      await deleteIds('client');
      await raw.client.deleteMany({ where: { name: { contains: `retainer client ${suffix}` } } });
      await raw.user.deleteMany({ where: { email: `soft-delete-${suffix}@example.test` } });
      await raw.organization.deleteMany({ where: { slug: `soft-delete-${suffix}` } });
      await raw.$disconnect();
    }
  }
});
