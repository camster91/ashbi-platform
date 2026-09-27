#!/usr/bin/env node
/**
 * Break-glass recovery of an organization's administrator access (#416).
 * Runbook: docs/privileged-actions.md#break-glass-administrator-recovery.
 *
 * Disabled unless BREAK_GLASS_ENABLED=true. Run on the API host with the
 * production DATABASE_URL and PLATFORM_OPERATOR_USER_IDS.
 *
 * Issue a single-use, 30-minute grant for a locked-out administrator:
 *   BREAK_GLASS_ENABLED=true node scripts/break-glass.mjs issue \
 *     --organization-id <orgId> --email <admin@agency.test> \
 *     --operator <platformOperatorUserId> --reason "<why, 10-500 chars>" [--promote] --confirm
 *
 * Revoke an outstanding grant (works with the flag off):
 *   node scripts/break-glass.mjs revoke --grant <grantId> --operator <platformOperatorUserId>
 *
 * List an organization's recent grants (no tokens are ever shown again):
 *   node scripts/break-glass.mjs list --organization-id <orgId>
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  BreakGlassError,
  issueBreakGlassGrant,
  revokeBreakGlassGrant,
} from '../src/auth/break-glass.js';

const { PrismaClient } = prismaPkg;
const [command] = process.argv.slice(2);
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
const flag = (name) => process.argv.includes(name);

function usage(message) {
  if (message) console.error(message);
  console.error([
    'Usage:',
    '  node scripts/break-glass.mjs issue --organization-id <id> (--email <email> | --user-id <id>) --operator <userId> --reason "<text>" [--promote] --confirm',
    '  node scripts/break-glass.mjs revoke --grant <grantId> --operator <userId>',
    '  node scripts/break-glass.mjs list --organization-id <id>',
  ].join('\n'));
  process.exit(2);
}

if (!['issue', 'revoke', 'list'].includes(command)) usage();
if (!process.env.DATABASE_URL) usage('DATABASE_URL is required.');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  if (command === 'issue') {
    const organizationId = option('--organization-id');
    const email = option('--email');
    const userId = option('--user-id');
    const operatorId = option('--operator');
    const reason = option('--reason');
    if (!organizationId || !(email || userId) || !operatorId || !reason) usage('Missing a required option.');
    if (!flag('--confirm')) usage('Add --confirm: this issues emergency administrator access and notifies the organization.');
    const { grant, token, target, organization } = await issueBreakGlassGrant(prisma, {
      organizationId,
      targetEmail: email ?? undefined,
      targetUserId: userId ?? undefined,
      operatorId,
      reason,
      promoteToAdmin: flag('--promote'),
    });
    const base = (process.env.APP_URL || process.env.HUB_URL || 'http://localhost:5173').replace(/\/$/, '');
    console.log(JSON.stringify({
      grantId: grant.id,
      organization: { id: organization.id, name: organization.name },
      target: { id: target.id, email: target.email, role: target.role },
      promoteToAdmin: grant.promoteToAdmin,
      expiresAt: grant.expiresAt.toISOString(),
    }, null, 2));
    // The token is printed once, on its own line, and is never stored.
    console.log('\nSingle-use recovery link (give it to the verified person only, over a separate channel):');
    console.log(`${base}/break-glass#token=${token}`);
    return;
  }

  if (command === 'revoke') {
    const grantId = option('--grant');
    const operatorId = option('--operator');
    if (!grantId || !operatorId) usage('Missing a required option.');
    console.log(JSON.stringify(await revokeBreakGlassGrant(prisma, { grantId, operatorId })));
    return;
  }

  const organizationId = option('--organization-id');
  if (!organizationId) usage('Missing --organization-id.');
  const grants = await prisma.breakGlassGrant.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, targetUserId: true, operatorId: true, reason: true, promoteToAdmin: true,
      createdAt: true, expiresAt: true, redeemedAt: true, revokedAt: true,
    },
  });
  console.log(JSON.stringify(grants, null, 2));
}

main()
  .catch((error) => {
    if (error instanceof BreakGlassError) {
      console.error(`${error.code}: ${error.message}`);
      process.exitCode = 1;
    } else {
      console.error(error?.message || error);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
