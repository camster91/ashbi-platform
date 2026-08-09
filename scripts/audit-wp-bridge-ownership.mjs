import prisma from '../src/config/db.js';
import { pathToFileURL } from 'node:url';

const models = [
  ['wPSite', 'wp_sites', 'WordPress sites'], ['wPBackup', 'wp_backups', 'backups'],
  ['wPReport', 'wp_reports', 'reports'], ['wPAlert', 'wp_alerts', 'alerts'],
  ['wPFleetOp', 'wp_fleet_ops', 'fleet operations'],
  ['wPMagicLoginLog', 'wp_magic_login_log', 'magic-login logs'],
  ['supportHourEntry', 'support_hours', 'support hours']
];

export async function auditWpBridgeOwnership(prismaClient) {
  const report = {};
  for (const [model, table, label] of models) {
    // Raw SQL is intentional: once organizationId becomes non-nullable,
    // Prisma rejects `where: { organizationId: null }` before querying. The
    // database-level audit must continue to work both before and after the
    // constraint is tightened.
    const [{ count: unowned }] = await prismaClient.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "organizationId" IS NULL`
    );
    report[model] = {
      label,
      total: await prismaClient[model].count(),
      unowned
    };
  }
  report.unownedSites = await prismaClient.$queryRawUnsafe(
    'SELECT id, url, "clientId", "projectId" FROM "wp_sites" WHERE "organizationId" IS NULL ORDER BY "createdAt" ASC'
  );
  const [{ count: unprovisionedCredentials }] = await prismaClient.$queryRawUnsafe(
    'SELECT COUNT(*)::int AS count FROM "wp_sites" WHERE "bridgeSecretEncrypted" IS NULL'
  );
  report.wPSite.unprovisionedCredentials = unprovisionedCredentials;
  return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const report = await auditWpBridgeOwnership(prisma);
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
  if (
    Object.values(report).some((value) => value && typeof value === 'object' && 'unowned' in value && value.unowned > 0) ||
    report.wPSite.unprovisionedCredentials > 0
  ) {
    process.exitCode = 2;
  }
}
