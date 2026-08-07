import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';

function recorder() {
  const calls = [];
  const delegate = { findFirst: async (args) => { calls.push(args); return null; } };
  return { calls, prisma: { attachment: delegate, project: delegate } };
}

test('attachment lookup is scoped through the uploader organization', async () => {
  const orgA = recorder();
  await createScopedPrisma(orgA.prisma, 'org-a').attachment.findFirst({ where: { filename: 'shared.pdf' } });
  assert.deepEqual(orgA.calls[0].where, {
    AND: [{ filename: 'shared.pdf' }, { uploadedBy: { organizationId: 'org-a' } }]
  });

  const orgB = recorder();
  await createScopedPrisma(orgB.prisma, 'org-b').attachment.findFirst({ where: { filename: 'shared.pdf' } });
  assert.deepEqual(orgB.calls[0].where.AND[1], { uploadedBy: { organizationId: 'org-b' } });
  assert.notDeepEqual(orgA.calls[0].where, orgB.calls[0].where);
});

test('attachment entity authorization scopes projects directly by organization', async () => {
  const recorded = recorder();
  await createScopedPrisma(recorded.prisma, 'org-a').project.findFirst({ where: { id: 'project-b' }, select: { id: true } });
  assert.deepEqual(recorded.calls[0].where, { id: 'project-b', deletedAt: null, organizationId: 'org-a' });
});
