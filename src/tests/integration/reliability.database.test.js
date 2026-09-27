import test from 'node:test';
import assert from 'node:assert/strict';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { checkAllEscalations } from '../../jobs/escalation.js';
import { updateAllProjectHealth } from '../../services/project.service.js';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

const { PrismaClient } = prismaPkg;
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const SLA = { CRITICAL: 2, HIGH: 12, NORMAL: 24, LOW: 48 };

async function withTenant(raw, label, callback) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organization = await raw.organization.create({ data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}` } });
  try {
    return await callback({ organizationId: organization.id, suffix, scoped: createScopedPrisma(raw, organization.id) });
  } finally {
    await raw.notification.deleteMany({ where: { user: { organizationId: organization.id } } });
    await raw.thread.deleteMany({ where: { client: { organizationId: organization.id } } });
    await raw.project.deleteMany({ where: { organizationId: organization.id } });
    await raw.client.deleteMany({ where: { organizationId: organization.id } });
    await raw.user.deleteMany({ where: { organizationId: organization.id } });
    await raw.organization.delete({ where: { id: organization.id } });
  }
}

test('real database: project health history accumulates as a capped array', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await withTenant(raw, 'rel-health', async ({ organizationId, scoped }) => {
      const client = await raw.client.create({ data: { organizationId, name: 'Health client' } });
      const active = await raw.project.create({ data: { organizationId, clientId: client.id, name: 'Active' } });
      const launched = await raw.project.create({
        data: { organizationId, clientId: client.id, name: 'Launched', status: 'LAUNCHED', healthScore: 5 },
      });
      // The shape the old `{ push }` update actually stored.
      await raw.project.update({
        where: { id: active.id },
        data: { healthHistory: { push: { health: 'AT_RISK', score: 40, timestamp: '2026-09-01T00:00:00.000Z' } } },
      });

      await updateAllProjectHealth(scoped, { now: new Date('2026-09-27T10:00:00.000Z') });
      await raw.thread.create({
        data: { subject: 'Critical', priority: 'CRITICAL', status: 'OPEN', clientId: client.id, projectId: active.id },
      });
      await updateAllProjectHealth(scoped, { now: new Date('2026-09-27T11:00:00.000Z') });
      await updateAllProjectHealth(scoped, { now: new Date('2026-09-27T12:00:00.000Z') });

      const stored = await raw.project.findUnique({ where: { id: active.id }, select: { healthHistory: true, healthScore: true } });
      assert.ok(Array.isArray(stored.healthHistory));
      assert.deepEqual(stored.healthHistory.map((point) => point.score), [40, 100, 70]);
      assert.equal(stored.healthScore, 70);
      const untouched = await raw.project.findUnique({ where: { id: launched.id }, select: { healthHistory: true, healthScore: true } });
      assert.equal(untouched.healthHistory, null, 'launched projects are not scored');
      assert.equal(untouched.healthScore, 5);
    });
  } finally {
    await raw.$disconnect();
  }
});

test('real database: each escalation level notifies once per thread across sweeps', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await withTenant(raw, 'rel-escalation', async ({ organizationId, suffix, scoped }) => {
      const admin = await raw.user.create({
        data: { organizationId, email: `rel-admin-${suffix}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN' },
      });
      const assignee = await raw.user.create({
        data: { organizationId, email: `rel-team-${suffix}@example.test`, name: 'Team', password: 'x', role: 'TEAM' },
      });
      const client = await raw.client.create({ data: { organizationId, name: 'Escalation client' } });
      const start = new Date('2026-09-27T00:00:00.000Z');
      const thread = await raw.thread.create({
        data: {
          subject: 'Waiting',
          status: 'AWAITING_RESPONSE',
          clientId: client.id,
          assignedToId: assignee.id,
          lastActivityAt: start,
        },
      });
      const at = (hours) => new Date(start.getTime() + hours * 3_600_000);

      for (const hours of [4, 4.25, 4.5, 7.75, 8, 8.25, 12, 20]) {
        await checkAllEscalations({ prisma: scoped, slaDefaults: SLA, now: at(hours) });
      }
      const notifications = await raw.notification.findMany({
        where: { userId: { in: [admin.id, assignee.id] } },
        orderBy: { createdAt: 'asc' },
      });
      assert.deepEqual(notifications.map((n) => `${n.type}:${n.userId === admin.id ? 'admin' : 'assignee'}`), [
        'SLA_WARNING:assignee',
        'ESCALATION:admin',
      ]);
      const stored = await raw.thread.findUnique({ where: { id: thread.id } });
      assert.equal(stored.lastEscalationLevel, 2);
      assert.equal(stored.lastEscalatedAt.toISOString(), at(8).toISOString());
    });
  } finally {
    await raw.$disconnect();
  }
});
