// The weekly digest's AI call must run inside each organization's tenant
// context, so governance applies that organization's kill switch and BYOK
// connection (#413 security review B2).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const { runWeeklyDigest } = await import('../../jobs/weekly-digest.js');
const { getRequestOrganizationId } = await import('../../utils/request-context.js');

function fakePrisma(organizationIds) {
  const zero = { count: async () => 0 };
  const digests = [];
  const client = {
    organization: {
      findMany: async () => organizationIds.map((id) => ({ id })),
      findUnique: async ({ where }) => (organizationIds.includes(where.id) ? { id: where.id } : null),
    },
    thread: zero,
    proposal: zero,
    task: zero,
    client: { findMany: async () => [] },
    retainerPlan: { findMany: async () => [] },
    weeklyDigest: { create: async ({ data }) => { digests.push(data); return data; } },
  };
  return { client, digests };
}

test('every digest AI call sees its own organization, never a null one', async () => {
  const { client, digests } = fakePrisma(['org-a', 'org-b']);
  const seen = [];
  const result = await runWeeklyDigest({
    prisma: client,
    backgroundPrisma: client,
    chat: async () => {
      seen.push(getRequestOrganizationId() ?? null);
      return 'digest text';
    },
  });
  assert.deepEqual(seen, ['org-a', 'org-b']);
  assert.deepEqual(result.organizations.map((row) => row.organizationId), ['org-a', 'org-b']);
  assert.equal(digests.length, 2);
  assert.ok(digests.every((row) => row.fullDigest === 'digest text'));
});

test('a digest whose AI call is refused still stores the numbers-only digest', async () => {
  const { client, digests } = fakePrisma(['org-a']);
  await runWeeklyDigest({ prisma: client, backgroundPrisma: client, chat: async () => { throw new Error('AI_DISABLED'); } });
  assert.match(digests[0].fullDigest, /^Weekly Digest/);
});

test('no worker builds a scoped client for AI work outside runTenantJob', () => {
  // The digest loop used createScopedPrisma without entering request storage,
  // so AI calls ran with no organization. Every job file must go through
  // runTenantJob instead.
  const jobsDir = new URL('../../jobs/', import.meta.url);
  for (const file of fs.readdirSync(jobsDir).filter((name) => name.endsWith('.js') && name !== 'tenant-iteration.js')) {
    const source = fs.readFileSync(new URL(file, jobsDir), 'utf8');
    assert.doesNotMatch(source, /createScopedPrisma\(/, `${file} must use runTenantJob, not createScopedPrisma`);
  }
});
