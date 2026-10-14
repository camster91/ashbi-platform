import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import timeRoutes from '../../routes/time.routes.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('archived-project time labels remain identifiable and tenant scoped in the summary API', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 60_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `archived-time-${key}-${randomUUID()}`);
  const app = Fastify();
  try {
    const people = [], projects = [];
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, name: 'Archived time QA', slug: organizationId } });
      const client = await raw.client.create({ data: { organizationId, name: 'Canonical client' } });
      people.push(await raw.user.create({ data: { organizationId, role: 'ADMIN', name: 'Summary owner', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: client.id, name: `Archived ${organizationId}`, portfolio: 'FREELANCE', deletedAt: new Date() } }));
      await raw.timeEntry.create({ data: { projectId: projects.at(-1).id, userId: people.at(-1).id, duration: 60, date: new Date(), billable: true } });
    }
    const scoped = createScopedPrisma(raw, orgs[0]);
    app.decorate('authenticate', async request => { request.user = people[0]; request.prisma = scoped; });
    await app.register(timeRoutes, { prefix: '/api' });
    const response = await app.inject({ method: 'GET', url: '/api/time-entries/summary?portfolio=FREELANCE' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().totalMinutes, 60);
    assert.equal(response.json().byProject.length, 1);
    assert.equal(response.json().byProject[0].project.name, projects[0].name);
    assert.ok(!JSON.stringify(response.json()).includes(projects[1].name));
    assert.equal(await scoped.project.findFirst({ where: { id: projects[0].id } }), null);
  } finally {
    await app.close();
    await raw.timeEntry.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
