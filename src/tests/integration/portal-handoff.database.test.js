import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { createPortalHandoff, readPortalHandoff, listPortalHandoffs, readStaffHandoff, listStaffHandoffs, transitionHandoff } from '../../services/portal-handoff.service.js';
const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('migrated human handoffs preserve principal boundaries, durable intents, one claim owner and raw lifecycle guards', { skip: !url && 'Disposable PostgreSQL not configured', timeout: 120000 }, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const suffix = randomUUID(), orgs = [`handoff-a-${suffix}`, `handoff-b-${suffix}`];
  try {
    for (const id of orgs) await raw.organization.create({ data: { id, slug: id, name: 'Handoff fixture' } });
    const client = await raw.client.create({ data: { name: 'Handoff client', organizationId: orgs[0] } });
    const project = await raw.project.create({ data: { name: 'Handoff project', organizationId: orgs[0], clientId: client.id } });
    const users = [];
    for (const [key, role] of [['a', 'CLIENT'], ['b', 'CLIENT'], ['admin', 'ADMIN'], ['team', 'TEAM'], ['other', 'TEAM']]) {
      const user = await raw.user.create({ data: { email: `${key}-${suffix}@example.invalid`, name: key, password: randomUUID(), role, organizationId: orgs[0], ...(role === 'CLIENT' ? { clientId: client.id } : {}) } });
      const contact = role === 'CLIENT' ? await raw.contact.create({ data: { email: user.email, name: key, clientId: client.id } }) : null;
      users.push({ ...user, ...(contact ? { contactId: contact.id } : {}) });
    }
    const [a, b, admin, team, other] = users;
    const input = { question: 'Synthetic human follow-up', idempotencyKey: randomUUID() };
    const requests = await Promise.allSettled([createPortalHandoff(raw, a, project.id, input), createPortalHandoff(raw, a, project.id, input)]);
    assert.ok(requests.some(row => row.status === 'fulfilled'));
    for (const result of requests.filter(row => row.status === 'rejected')) assert.equal(result.reason.statusCode, 409);
    assert.equal(await raw.portalHandoffRequest.count({ where: { organizationId: orgs[0] } }), 1);
    const record = (await readPortalHandoff(raw, a, project.id, { idempotencyKey: input.idempotencyKey })).request;
    assert.equal((await createPortalHandoff(raw, a, project.id, input)).request.id, record.id);
    await assert.rejects(readPortalHandoff(raw, b, project.id, { requestId: record.id }), { statusCode: 404 });
    await assert.rejects(readPortalHandoff(raw, b, project.id, { idempotencyKey: input.idempotencyKey }), { statusCode: 404 });
    await assert.rejects(listPortalHandoffs(raw, b, project.id, { after: record.id }), { statusCode: 404 });
    assert.equal((await listPortalHandoffs(raw, b, project.id)).items.length, 0);
    const anotherClient = await raw.client.create({ data: { name: 'Other same-org client', organizationId: orgs[0] } });
    await raw.project.update({ where: { id: project.id }, data: { clientId: anotherClient.id } });
    assert.equal((await listStaffHandoffs(raw, admin)).items.length, 0);
    await assert.rejects(readStaffHandoff(raw, admin, record.id), { statusCode: 404 });
    await assert.rejects(transitionHandoff(raw, team, record.id, 'claim', { revision: 1 }), { statusCode: 404 });
    await raw.project.update({ where: { id: project.id }, data: { clientId: client.id } });
    await raw.user.update({ where: { id: a.id }, data: { sessionVersion: { increment: 1 } } });
    await assert.rejects(readPortalHandoff(raw, a, project.id, { requestId: record.id }), { statusCode: 401 });
    const fresh = { ...a, sessionVersion: 1 };
    assert.equal((await readPortalHandoff(raw, fresh, project.id, { requestId: record.id })).request.id, record.id);
    await raw.contact.delete({ where: { id: a.contactId } });
    await assert.rejects(readPortalHandoff(raw, fresh, project.id, { requestId: record.id }), { statusCode: 401 });
    const replacement = await raw.contact.create({ data: { clientId: client.id, email: a.email, name: 'Replacement' } });
    assert.equal((await listPortalHandoffs(raw, { ...fresh, contactId: replacement.id }, project.id)).items.length, 0);
    const claims = await Promise.allSettled([team, other].map(actor => transitionHandoff(raw, actor, record.id, 'claim', { revision: 1 })));
    assert.equal(claims.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(claims.find(row => row.status === 'rejected').reason.statusCode, 409);
    const stored = await raw.portalHandoffRequest.findUnique({ where: { id: record.id } });
    const owner = stored.ownerId === team.id ? team : other, nonowner = stored.ownerId === team.id ? other : team;
    await assert.rejects(transitionHandoff(raw, nonowner, record.id, 'resolve', { revision: 2 }), { statusCode: 409 });
    await assert.rejects(raw.portalHandoffRequest.update({ where: { id: record.id }, data: { question: 'changed' } }));
    await assert.rejects(raw.portalHandoffRequest.update({ where: { id: record.id }, data: { ownerId: nonowner.id, changedById: nonowner.id, revision: 3 } }));
    await raw.user.update({ where: { id: owner.id }, data: { isActive: false } });
    await assert.rejects(transitionHandoff(raw, owner, record.id, 'resolve', { revision: 2 }), { statusCode: 403 });
    await transitionHandoff(raw, admin, record.id, 'requeue', { revision: 2, reason: 'OWNER_UNAVAILABLE' });
    await assert.rejects(transitionHandoff(raw, admin, record.id, 'claim', { revision: 2 }), { statusCode: 409 });
    await transitionHandoff(raw, admin, record.id, 'claim', { revision: 3 });
    await transitionHandoff(raw, admin, record.id, 'resolve', { revision: 4 });
    await assert.rejects(raw.portalHandoffRequest.update({ where: { id: record.id }, data: { revision: 6 } }));
    await assert.rejects(raw.portalHandoffRequest.delete({ where: { id: record.id } }));
    assert.equal(await raw.auditEvent.count({ where: { organizationId: orgs[0], action: 'portal_handoff.requested' } }), 1);
    assert.doesNotMatch(JSON.stringify(await raw.auditEvent.findMany({ where: { organizationId: orgs[0] } })), /Synthetic human follow-up/);
    const foreign = await raw.user.create({ data: { organizationId: orgs[1], email: `foreign-${suffix}@example.invalid`, name: 'Foreign', password: randomUUID(), role: 'ADMIN' } });
    await assert.rejects(transitionHandoff(raw, foreign, record.id, 'claim', { revision: 5 }), { statusCode: 404 });
  } finally {
    // Same privileged disposable-fixture convention as audit-cleanup.js. Only
    // this test's UUID organizations are purged; normal roles cannot bypass it.
    await raw.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe('DELETE FROM "portal_handoff_requests" WHERE "organizationId" = ANY($1::text[])', orgs);
    });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) {
      await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.contact.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
      await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
      await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    }
    await raw.$disconnect();
  }
});
