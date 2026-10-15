import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClientAssistantContext } from '../../services/client-assistant-context.service.js';

const scope = { organizationId: 'org-a', clientId: 'client-a' };
const client = { id: 'client-a', name: 'Example', domain: 'example.test', organizationId: 'org-a', deletedAt: null };
const project = (id = 'project-a') => ({
  id, name: 'Launch', status: 'ACTIVE', startDate: null, endDate: null,
  organizationId: 'org-a', clientId: 'client-a', deletedAt: null,
});

function fakePrisma(clientResult = client, projects = []) {
  const reads = [];
  // Only read methods exist: a write or model call would fail this fixture.
  return {
    reads,
    prisma: {
      client: { findFirst: async (args) => { reads.push(['client', args]); return clientResult; } },
      project: { findMany: async (args) => { reads.push(['project', args]); return projects; } },
    },
  };
}

test('context uses exact organization/client scope and whitelisted columns', async () => {
  const { prisma, reads } = fakePrisma(client, [project()]);
  assert.deepEqual(await buildClientAssistantContext(prisma, scope), {
    client: { id: 'client-a', name: 'Example', domain: 'example.test' },
    projects: [{ id: 'project-a', name: 'Launch', status: 'ACTIVE', startDate: null, endDate: null }],
    truncated: false,
  });
  assert.deepEqual(reads[0][1], {
    where: { id: 'client-a', organizationId: 'org-a', deletedAt: null },
    select: { id: true, name: true, domain: true, organizationId: true, deletedAt: true },
  });
  assert.deepEqual(reads[1][1], {
    where: { clientId: 'client-a', organizationId: 'org-a', deletedAt: null },
    select: { id: true, name: true, status: true, startDate: true, endDate: true, clientId: true, organizationId: true, deletedAt: true },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 26,
  });
});

for (const [label, result] of [
  ['missing', null], ['foreign', { ...client, organizationId: 'org-b' }],
  ['different', { ...client, id: 'client-b' }], ['deleted', { ...client, deletedAt: new Date() }],
]) {
  test(`${label} client returns null without looking up projects`, async () => {
    const { prisma, reads } = fakePrisma(result, [project()]);
    assert.equal(await buildClientAssistantContext(prisma, scope), null);
    assert.deepEqual(reads.map(([model]) => model), ['client']);
  });
}

test('invalid scope performs no queries', async () => {
  const { prisma, reads } = fakePrisma();
  for (const invalid of [{ organizationId: '', clientId: 'client-a' }, { organizationId: 'org-a', clientId: '' }]) {
    assert.equal(await buildClientAssistantContext(prisma, invalid), null);
  }
  assert.deepEqual(reads, []);
});

test('defensive projection excludes internal fields and unauthorized project rows', async () => {
  const hidden = { contacts: ['private'], summary: 'secret', budget: 100, risks: ['private'], drafts: ['private'], tokens: 'secret', chat: ['private'] };
  const { prisma } = fakePrisma({ ...client, ...hidden }, [
    { ...project(), ...hidden },
    { ...project('foreign'), organizationId: 'org-b' },
    { ...project('other-client'), clientId: 'client-b' },
    { ...project('deleted'), deletedAt: new Date() },
  ]);
  const context = await buildClientAssistantContext(prisma, scope);
  assert.deepEqual(Object.keys(context.client), ['id', 'name', 'domain']);
  assert.deepEqual(context.projects.map((row) => row.id), ['project-a']);
  assert.deepEqual(Object.keys(context.projects[0]), ['id', 'name', 'status', 'startDate', 'endDate']);
  assert.equal(context.truncated, false);
});

test('project preview is capped at 25 with accurate truncation', async () => {
  for (const count of [0, 24, 25, 26]) {
    const { prisma } = fakePrisma(client, Array.from({ length: count }, (_, i) => project(`project-${i}`)));
    const context = await buildClientAssistantContext(prisma, scope);
    assert.equal(context.projects.length, Math.min(count, 25));
    assert.equal(context.truncated, count > 25);
  }
});
