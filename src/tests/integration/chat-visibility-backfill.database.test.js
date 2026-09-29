// The chat-visibility backfill (migration 20260927030000) marks as
// client-visible only messages a CLIENT-role user wrote on a project of that
// user's own client. An account whose role was later changed to CLIENT keeps
// its earlier staff messages INTERNAL (Codex P1 on #480). The migration's own
// UPDATE runs here, scoped to this fixture's organization.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

function scopedBackfill() {
  const sql = readFileSync(new URL('../../../prisma/migrations/20260927030000_chat_message_visibility/migration.sql', import.meta.url), 'utf8');
  const start = sql.indexOf('UPDATE "chat_messages"', sql.indexOf('-- Backfill:'));
  const update = sql.slice(start, sql.indexOf(';', start));
  assert.match(update, /WHERE m\."authorId" = u\."id"/);
  return update.replace('WHERE m."authorId" = u."id"', 'WHERE p."organizationId" = $1 AND m."authorId" = u."id"');
}

test('the backfill promotes only client users\' messages on their own client\'s projects', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 60_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const s = randomUUID();
  const org = `backfill-org-${s}`;
  try {
    await raw.organization.create({ data: { id: org, name: 'Backfill', slug: `backfill-${s}` } });
    await raw.client.createMany({ data: [
      { id: `${org}-ca`, name: 'Client A', organizationId: org },
      { id: `${org}-cb`, name: 'Client B', organizationId: org },
    ] });
    await raw.project.createMany({ data: [
      { id: `${org}-pa`, name: 'Project A', clientId: `${org}-ca`, organizationId: org },
      { id: `${org}-pb`, name: 'Project B', clientId: `${org}-cb`, organizationId: org },
    ] });
    await raw.user.createMany({ data: [
      { id: `${org}-client`, email: `client-${s}@example.test`, name: 'Client user', password: 'x', role: 'CLIENT', clientId: `${org}-ca`, organizationId: org },
      // A former staff member whose role was changed to CLIENT without a client.
      { id: `${org}-former`, email: `former-${s}@example.test`, name: 'Former staff', password: 'x', role: 'CLIENT', organizationId: org },
      { id: `${org}-staff`, email: `staff-${s}@example.test`, name: 'Staff', password: 'x', role: 'TEAM', organizationId: org },
    ] });
    const message = (id, authorId, projectId) => ({ id: `${org}-${id}`, content: id, authorId: `${org}-${authorId}`, projectId: `${org}-${projectId}` });
    await raw.chatMessage.createMany({ data: [
      message('client-own', 'client', 'pa'),
      message('client-other', 'client', 'pb'),
      message('former-staff', 'former', 'pa'),
      message('staff', 'staff', 'pa'),
    ] });

    await raw.$executeRawUnsafe(scopedBackfill(), org);
    const rows = await raw.chatMessage.findMany({ where: { projectId: { in: [`${org}-pa`, `${org}-pb`] } }, select: { content: true, visibility: true } });
    assert.deepEqual(Object.fromEntries(rows.map((row) => [row.content, row.visibility])), {
      'client-own': 'CLIENT',
      'client-other': 'INTERNAL',
      'former-staff': 'INTERNAL',
      staff: 'INTERNAL',
    });
  } finally {
    await raw.chatMessage.deleteMany({ where: { project: { organizationId: org } } });
    await raw.user.deleteMany({ where: { organizationId: org } });
    await raw.project.deleteMany({ where: { organizationId: org } });
    await raw.client.deleteMany({ where: { organizationId: org } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
});
