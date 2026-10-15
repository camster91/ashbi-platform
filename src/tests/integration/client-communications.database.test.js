import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { listClientCommunications, readClientCommunication } from '../../services/client-communications.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('stored client communication timeline uses canonical PostgreSQL ownership, assignment and stable union pagination', { skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000 }, async () => {
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `communication-${key}-${randomUUID()}`);
  const users = [], clients = [], projects = [], threadIds = [];
  try {
    for (const organizationId of orgs) {
      await raw.organization.create({ data: { id: organizationId, slug: organizationId, name: 'Stored communication QA' } });
      users.push(await raw.user.create({ data: { organizationId, email: `${randomUUID()}@e2e.example.test`, name: 'Communication admin', password: randomUUID(), role: 'ADMIN' } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Communication client' } }));
      projects.push(await raw.project.create({ data: { organizationId, clientId: clients.at(-1).id, name: 'Communication project' } }));
    }
    const teammate = await raw.user.create({ data: { organizationId: orgs[0], email: `${randomUUID()}@e2e.example.test`, name: 'Communication teammate', password: randomUUID(), role: 'TEAM' } });
    const receivedAt = new Date('2026-10-14T12:00:00.000Z');
    const expected = [];
    for (let index = 0; index < 3; index++) {
      const thread = await raw.thread.create({ data: { subject: `Stored thread ${index}`, clientId: clients[0].id, assignedToId: index === 0 ? teammate.id : users[0].id } }); threadIds.push(thread.id);
      const message = await raw.message.create({ data: { threadId: thread.id, direction: 'INBOUND', senderEmail: 'client@example.test', subject: thread.subject, bodyText: `Stored message ${index}`, bodyHtml: 'PRIVATE HTML', aiExtracted: 'PRIVATE METADATA', receivedAt } });
      expected.push(`inbox:${message.id}`);
      const communication = await raw.projectCommunication.create({ data: { projectId: projects[0].id, gmailThreadId: randomUUID(), gmailMessageId: randomUUID(), from: 'client@example.test', to: 'PRIVATE RECIPIENT', account: 'PRIVATE ACCOUNT', subject: `Project email ${index}`, bodySnippet: 'Stored snippet', fullBody: `Full project email ${index}`, direction: 'OUTBOUND', receivedAt } });
      expected.push(`project:${communication.id}`);
    }
    const projectOnly = await raw.thread.create({ data: { subject: 'Excluded project-only thread', projectId: projects[0].id } }); threadIds.push(projectOnly.id);
    await raw.message.create({ data: { threadId: projectOnly.id, direction: 'INBOUND', senderEmail: 'client@example.test', bodyText: 'Project-only history', receivedAt } });
    const foreignThread = await raw.thread.create({ data: { subject: 'Foreign thread', clientId: clients[1].id } }); threadIds.push(foreignThread.id);
    const foreignMessage = await raw.message.create({ data: { threadId: foreignThread.id, direction: 'INBOUND', senderEmail: 'foreign@example.test', bodyText: 'PRIVATE FOREIGN', receivedAt } });
    const result = []; let after;
    do {
      const page = await listClientCommunications(raw, users[0], clients[0].id, { limit: 2, ...(after ? { after } : {}) });
      assert.equal(page.coverage.complete, false); assert.equal(page.coverage.exclusions.length, 1);
      assert.doesNotMatch(JSON.stringify(page), /PRIVATE|bodyHtml|aiExtracted|fullBody|bodyText|account/);
      result.push(...page.items.map(item => `${item.source}:${item.id}`)); after = page.nextCursor;
    } while (after);
    assert.deepEqual([...result].sort(), expected.sort()); assert.equal(new Set(result).size, 6);
    const team = await listClientCommunications(raw, teammate, clients[0].id);
    assert.equal(team.items.filter(item => item.source === 'inbox').length, 1);
    assert.equal(team.items.filter(item => item.source === 'project').length, 3);
    const unassigned = result.find(key => key.startsWith('inbox:') && !team.items.some(item => key === `inbox:${item.id}`)).slice(6);
    await assert.rejects(readClientCommunication(raw, teammate, clients[0].id, 'inbox', unassigned), { statusCode: 404 });
    await assert.rejects(readClientCommunication(raw, users[0], clients[0].id, 'inbox', foreignMessage.id), { statusCode: 404 });
    await assert.rejects(listClientCommunications(raw, users[1], clients[0].id), { statusCode: 404 });
    const email = team.items.find(item => item.source === 'project');
    assert.match((await readClientCommunication(raw, teammate, clients[0].id, 'project', email.id)).bodyText, /Full project email/);
    const secondClient = await raw.client.create({ data: { organizationId: orgs[0], name: 'Reassigned communication client' } });
    await raw.project.update({ where: { id: projects[0].id }, data: { clientId: secondClient.id } });
    assert.equal((await listClientCommunications(raw, users[0], clients[0].id)).items.filter(item => item.source === 'project').length, 0);
    await assert.rejects(readClientCommunication(raw, users[0], clients[0].id, 'project', email.id), { statusCode: 404 });
    await raw.user.update({ where: { id: teammate.id }, data: { role: 'CLIENT' } });
    await assert.rejects(listClientCommunications(raw, teammate, clients[0].id), { statusCode: 403 });
    await raw.client.update({ where: { id: clients[0].id }, data: { deletedAt: new Date() } });
    await assert.rejects(listClientCommunications(raw, users[0], clients[0].id), { statusCode: 404 });
  } finally {
    await raw.message.deleteMany({ where: { threadId: { in: threadIds } } });
    await raw.thread.deleteMany({ where: { id: { in: threadIds } } });
    await raw.projectCommunication.deleteMany({ where: { projectId: { in: projects.map(project => project.id) } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
