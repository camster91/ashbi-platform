// Daily operator queue (#461) against a real, fully migrated database: rows
// come only from the caller's organization, finance and approval rows are
// admin-only (rows and counts), and each record lands in the documented view.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import { enterRequestContext } from '../../utils/request-context.js';
import workQueueRoutes from '../../routes/work-queue.routes.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

test('work queue is tenant-scoped, role-filtered, and assigns each source record to its view', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 8);
  const orgA = `wq-a-${suffix}`;
  const orgB = `wq-b-${suffix}`;
  const now = Date.now();
  const past = new Date(now - 3 * DAY);
  const future = new Date(now + 5 * DAY);
  let app;
  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Queue Tenant A', slug: orgA },
      { id: orgB, name: 'Queue Tenant B', slug: orgB },
    ] });
    const user = (id, org, role, name) => raw.user.create({ data: { id, email: `${id}@example.test`, name, password: 'x', role, organizationId: org } });
    const adminA = await user(`${orgA}-admin`, orgA, 'ADMIN', 'Ada Admin');
    const teamA = await user(`${orgA}-team`, orgA, 'TEAM', 'Tom Team');
    const adminB = await user(`${orgB}-admin`, orgB, 'ADMIN', 'Bea Admin');
    const botA = await user(`${orgA}-bot`, orgA, 'BOT', 'Bot');

    const clientA = await raw.client.create({ data: { name: 'Acme', organizationId: orgA } });
    const clientA2 = await raw.client.create({ data: { name: 'Globex', organizationId: orgA } });
    const clientB = await raw.client.create({ data: { name: 'Other tenant client', organizationId: orgB } });
    const projectA = await raw.project.create({ data: { name: 'Acme site', clientId: clientA.id, organizationId: orgA } });
    const projectA2 = await raw.project.create({ data: { name: 'Globex brand', clientId: clientA2.id, organizationId: orgA } });
    const projectB = await raw.project.create({ data: { name: 'Tenant B project', clientId: clientB.id, organizationId: orgB } });

    const task = (data) => raw.task.create({ data: { projectId: projectA.id, ...data } });
    const tAssigned = await task({ title: 'Write homepage copy', assigneeId: teamA.id, dueDate: future });
    const tBlocked = await task({ title: 'Blocked DNS change', status: 'BLOCKED', blockedBy: 'Client DNS access' });
    const tOverdue = await task({ title: 'Overdue QA pass', assigneeId: adminA.id, dueDate: past, status: 'IN_PROGRESS' });
    const tWaiting = await task({ title: 'Collect brand assets', assigneeId: teamA.id, category: 'WAITING_CLIENT' });
    const tOther = await task({ title: 'Globex logo round', projectId: projectA2.id, assigneeId: teamA.id });
    await task({ title: 'Done already', assigneeId: teamA.id, status: 'COMPLETED' });
    await task({ title: 'Unowned backlog idea' });
    await task({ title: 'Trashed task', assigneeId: teamA.id, deletedAt: new Date() });
    await raw.task.create({ data: { title: 'Tenant B task', projectId: projectB.id, assigneeId: adminB.id } });

    const approvalA = await raw.approval.create({ data: { type: 'EMAIL', title: 'Send launch email', projectId: projectA.id, content: '{}', createdBy: 'comms' } });
    await raw.approval.create({ data: { type: 'EMAIL', title: 'Already approved', status: 'APPROVED', projectId: projectA.id, content: '{}', createdBy: 'comms' } });
    await raw.approval.create({ data: { type: 'EMAIL', title: 'Tenant B approval', projectId: projectB.id, content: '{}', createdBy: 'comms' } });

    const file = (org, uploader, project, name) => raw.attachment.create({ data: {
      organizationId: org, filename: `${name}-${suffix}.png`, originalName: `${name}.png`, mimeType: 'image/png', size: 10,
      path: `/uploads/${name}-${suffix}.png`, entityType: 'PROJECT', entityId: project.id, uploadedById: uploader.id,
    } });
    const fileA = await file(orgA, adminA, projectA, 'mock');
    const fileB = await file(orgB, adminB, projectB, 'mock-b');
    const review = (data) => raw.reviewSession.create({ data: { organizationId: orgA, projectId: projectA.id, attachmentId: fileA.id, createdById: teamA.id, ...data } });
    const rInternal = await review({ title: 'Homepage v1 internal' });
    const rShared = await review({ title: 'Homepage v1 client', sharedWithClient: true, clientCanDecide: true });
    const rChanges = await review({ title: 'Logo v2', status: 'changes_requested', createdById: adminA.id });
    await review({ title: 'Approved banner', status: 'approved' });
    await raw.reviewSession.create({ data: { organizationId: orgB, projectId: projectB.id, attachmentId: fileB.id, createdById: adminB.id, title: 'Tenant B review' } });

    const proposalA = await raw.proposal.create({ data: { title: 'Acme retainer', status: 'SENT', clientId: clientA.id, projectId: projectA.id, createdById: adminA.id, validUntil: past, sentAt: past } });
    await raw.proposal.create({ data: { title: 'Draft proposal', clientId: clientA.id, createdById: adminA.id } });
    const contractA = await raw.contract.create({ data: { title: 'Acme MSA', status: 'SENT', content: '<p>MSA</p>', clientId: clientA.id, createdById: adminA.id } });
    const invoice = (data) => raw.invoice.create({ data: { clientId: clientA.id, organizationId: orgA, createdById: adminA.id, ...data } });
    const invSent = await invoice({ invoiceNumber: `WQ-${suffix}-1`, status: 'SENT', dueDate: future, total: 100, projectId: projectA.id });
    const invOverdue = await invoice({ invoiceNumber: `WQ-${suffix}-2`, status: 'SENT', dueDate: past, total: 200 });
    await invoice({ invoiceNumber: `WQ-${suffix}-3`, status: 'DRAFT', total: 300 });
    await invoice({ invoiceNumber: `WQ-${suffix}-4`, status: 'PAID', total: 400 });
    await raw.invoice.create({ data: { invoiceNumber: `WQ-${suffix}-B`, status: 'OVERDUE', clientId: clientB.id, organizationId: orgB, createdById: adminB.id, dueDate: past, total: 999 } });

    const principals = {
      adminA: { id: adminA.id, role: 'ADMIN', organizationId: orgA },
      teamA: { id: teamA.id, role: 'TEAM', organizationId: orgA },
      adminB: { id: adminB.id, role: 'ADMIN', organizationId: orgB },
      botA: { id: botA.id, role: 'BOT', organizationId: orgA },
    };
    app = Fastify();
    app.decorate('authenticate', async (request) => {
      request.user = principals[request.headers['x-test-user']];
    });
    // Mirrors tenancyMiddleware: the scoped client comes from the verified user.
    app.addHook('preHandler', async (request) => {
      const org = request.user.organizationId;
      const scoped = createScopedPrisma(raw, org);
      request.prisma = scoped;
      request.organizationId = org;
      enterRequestContext({ prisma: scoped, organizationId: org });
    });
    await app.register(workQueueRoutes, { prefix: '/api/work-queue' });

    const queue = async (who, query = '') => {
      const response = await app.inject({ method: 'GET', url: `/api/work-queue${query}`, headers: { 'x-test-user': who } });
      assert.equal(response.statusCode, 200, response.body);
      return response.json();
    };
    const viewOf = (body) => Object.fromEntries(body.rows.map((row) => [`${row.type}:${row.id}`, row.view]));

    // ── Admin in tenant A: every source, correct views ──
    const admin = await queue('adminA');
    assert.equal(admin.partial, false);
    assert.deepEqual(admin.failedSources, []);
    assert.deepEqual(admin.sources, ['tasks', 'approvals', 'reviews', 'proposals', 'contracts', 'invoices']);
    assert.deepEqual(viewOf(admin), {
      [`task:${tAssigned.id}`]: 'needs_action',
      [`task:${tBlocked.id}`]: 'at_risk',
      [`task:${tOverdue.id}`]: 'at_risk',
      [`task:${tWaiting.id}`]: 'waiting_on_client',
      [`task:${tOther.id}`]: 'needs_action',
      [`approval:${approvalA.id}`]: 'awaiting_approval',
      [`review:${rInternal.id}`]: 'awaiting_approval',
      [`review:${rShared.id}`]: 'waiting_on_client',
      [`review:${rChanges.id}`]: 'needs_action',
      [`proposal:${proposalA.id}`]: 'at_risk',
      [`contract:${contractA.id}`]: 'waiting_on_client',
      [`invoice:${invSent.id}`]: 'waiting_on_client',
      [`invoice:${invOverdue.id}`]: 'at_risk',
    });
    assert.deepEqual(admin.counts, { needs_action: 3, awaiting_approval: 2, waiting_on_client: 4, at_risk: 4 });
    assert.equal(admin.total, 13);

    const overdueRow = admin.rows.find((row) => row.id === tOverdue.id);
    assert.equal(overdueRow.state, 'OVERDUE');
    assert.equal(overdueRow.sourceUrl, `/task/${tOverdue.id}`);
    assert.deepEqual(overdueRow.client, { id: clientA.id, name: 'Acme' });
    assert.deepEqual(overdueRow.project, { id: projectA.id, name: 'Acme site' });
    assert.deepEqual(overdueRow.owner, { id: adminA.id, name: 'Ada Admin', role: null });
    assert.equal(overdueRow.ageDays, 0);
    for (const key of ['type', 'id', 'title', 'sourceUrl', 'client', 'project', 'owner', 'state', 'nextAction', 'dueAt', 'ageDays', 'view']) {
      assert.ok(Object.hasOwn(overdueRow, key), `row has ${key}`);
    }
    const invRow = admin.rows.find((row) => row.id === invOverdue.id);
    assert.equal(invRow.state, 'OVERDUE');
    assert.equal(invRow.sourceUrl, `/invoices/${invOverdue.id}`);
    assert.deepEqual(admin.rows.find((row) => row.id === invSent.id).project, { id: projectA.id, name: 'Acme site' });
    assert.equal(admin.rows.find((row) => row.id === rChanges.id).owner.name, 'Ada Admin');

    // View filter narrows rows but keeps every tab count.
    const atRisk = await queue('adminA', '?view=at_risk');
    assert.equal(atRisk.view, 'at_risk');
    assert.deepEqual(atRisk.counts, admin.counts);
    assert.ok(atRisk.rows.every((row) => row.view === 'at_risk'));
    assert.equal(atRisk.rows.length, 4);

    // Client and project filters.
    const globex = await queue('adminA', `?clientId=${clientA2.id}`);
    assert.deepEqual(globex.rows.map((row) => row.id), [tOther.id]);
    const byProject = await queue('adminA', `?projectId=${projectA2.id}`);
    assert.deepEqual(byProject.rows.map((row) => row.id), [tOther.id]);

    // Owner = me: the admin's own tasks, reviews and documents plus the
    // admin-owned approval queue.
    const adminMine = await queue('adminA', '?owner=me');
    assert.deepEqual(new Set(adminMine.rows.map((row) => row.id)), new Set([
      tOverdue.id, approvalA.id, rChanges.id, proposalA.id, contractA.id, invSent.id, invOverdue.id,
    ]));

    // ── TEAM member: no finance or approval rows, and no counts for them ──
    const team = await queue('teamA');
    assert.deepEqual(team.sources, ['tasks', 'reviews']);
    assert.ok(team.rows.every((row) => row.type === 'task' || row.type === 'review'), 'no finance or approval rows');
    assert.deepEqual(team.counts, { needs_action: 3, awaiting_approval: 1, waiting_on_client: 2, at_risk: 2 });
    assert.equal(team.total, 8);
    const teamMine = await queue('teamA', '?owner=me');
    assert.deepEqual(new Set(teamMine.rows.map((row) => row.id)), new Set([tAssigned.id, tWaiting.id, tOther.id, rInternal.id, rShared.id]));

    // ── Tenant B sees only its own records ──
    const other = await queue('adminB');
    assert.deepEqual(other.rows.map((row) => row.title).sort(), [
      'Invoice ' + `WQ-${suffix}-B`, 'Tenant B approval', 'Tenant B review', 'Tenant B task',
    ].sort());
    const aIds = new Set(admin.rows.map((row) => row.id));
    assert.ok(other.rows.every((row) => !aIds.has(row.id)), 'no tenant A rows leak to tenant B');
    // A foreign client id filters to nothing rather than reaching across tenants.
    const foreign = await queue('adminB', `?clientId=${clientA.id}`);
    assert.equal(foreign.total, 0);

    // ── Refused principals and invalid input ──
    const bot = await app.inject({ method: 'GET', url: '/api/work-queue', headers: { 'x-test-user': 'botA' } });
    assert.equal(bot.statusCode, 403);
    const badView = await app.inject({ method: 'GET', url: '/api/work-queue?view=everything', headers: { 'x-test-user': 'adminA' } });
    assert.equal(badView.statusCode, 400);
  } finally {
    await app?.close();
    for (const org of [orgA, orgB]) {
      await raw.reviewSession.deleteMany({ where: { organizationId: org } });
      await raw.approval.deleteMany({ where: { project: { organizationId: org } } });
      await raw.invoice.deleteMany({ where: { organizationId: org } });
      await raw.contract.deleteMany({ where: { client: { organizationId: org } } });
      await raw.proposal.deleteMany({ where: { client: { organizationId: org } } });
      await raw.task.deleteMany({ where: { project: { organizationId: org } } });
      await raw.project.deleteMany({ where: { organizationId: org } });
      await raw.attachment.deleteMany({ where: { organizationId: org } });
      await raw.client.deleteMany({ where: { organizationId: org } });
      await raw.user.deleteMany({ where: { organizationId: org } });
    }
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
