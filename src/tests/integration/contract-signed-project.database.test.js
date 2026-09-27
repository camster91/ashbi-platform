// Real-database proof for contract signing (H13): signing a contract whose
// proposal already belongs to a project reuses that project; a project is
// created only when the proposal has none, and it is linked back so a repeat
// run does not fork a second one.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database (the automation uses the application client, so
// DATABASE_URL must point at the same database, as in CI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { onContractSigned } from '../../services/automation.service.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

test('contract signing reuses the proposal project and only creates one when absent', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const org = `sign-org-${suffix}`;
  const user = `sign-user-${suffix}`;
  const client = `sign-client-${suffix}`;

  const signedContract = async (id, proposal) => {
    await raw.proposal.create({ data: { id: proposal.id, title: proposal.title, status: 'APPROVED', clientId: client, createdById: user, projectId: proposal.projectId ?? null } });
    return raw.contract.create({ data: {
      id, title: `Contract: ${proposal.title}`, status: 'SIGNED', content: '<p>Terms</p>', clientId: client, createdById: user,
      proposalId: proposal.id, signedAt: new Date(),
    } });
  };

  try {
    await raw.organization.create({ data: { id: org, name: 'Signing', slug: `sign-${suffix}` } });
    await raw.user.create({ data: { id: user, email: `sign-${suffix}@example.test`, name: 'Admin', password: 'x', role: 'ADMIN', organizationId: org } });
    await raw.client.create({ data: { id: client, name: 'Client', organizationId: org } });
    const existing = await raw.project.create({ data: { id: `sign-project-${suffix}`, name: 'Existing project', clientId: client, organizationId: org } });

    // Proposal already tied to a project: no new project.
    await signedContract(`sign-contract-a-${suffix}`, { id: `sign-proposal-a-${suffix}`, title: 'With project', projectId: existing.id });
    await onContractSigned(`sign-contract-a-${suffix}`);
    assert.deepEqual((await raw.project.findMany({ where: { clientId: client } })).map((project) => project.id), [existing.id]);

    // Proposal without a project: exactly one project is created and linked.
    await signedContract(`sign-contract-b-${suffix}`, { id: `sign-proposal-b-${suffix}`, title: 'New work' });
    await onContractSigned(`sign-contract-b-${suffix}`);
    const created = await raw.project.findMany({ where: { clientId: client, id: { not: existing.id } } });
    assert.equal(created.length, 1);
    assert.equal(created[0].organizationId, org);
    assert.equal(created[0].name, 'New work');
    const linked = await raw.proposal.findUnique({ where: { id: `sign-proposal-b-${suffix}` } });
    assert.equal(linked.projectId, created[0].id);

    // A repeated run (retry) reuses the linked project.
    await onContractSigned(`sign-contract-b-${suffix}`);
    assert.equal(await raw.project.count({ where: { clientId: client } }), 2);
  } finally {
    await raw.notification.deleteMany({ where: { userId: user } });
    await raw.activity.deleteMany({ where: { userId: user } });
    await raw.contract.deleteMany({ where: { clientId: client } });
    await raw.proposal.deleteMany({ where: { clientId: client } });
    await raw.project.deleteMany({ where: { clientId: client } });
    await raw.client.deleteMany({ where: { id: client } });
    await raw.user.deleteMany({ where: { id: user } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
});
