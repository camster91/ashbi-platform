import prisma from '../src/config/db.js';

const models = [
  ['wPSite', 'WordPress sites'], ['wPBackup', 'backups'], ['wPReport', 'reports'],
  ['wPAlert', 'alerts'], ['wPFleetOp', 'fleet operations'],
  ['wPMagicLoginLog', 'magic-login logs'], ['supportHourEntry', 'support hours']
];
const report = {};
for (const [model, label] of models) {
  report[model] = {
    label,
    total: await prisma[model].count(),
    unowned: await prisma[model].count({ where: { organizationId: null } })
  };
}
report.unownedSites = await prisma.wPSite.findMany({
  where: { organizationId: null },
  select: { id: true, url: true, clientId: true, projectId: true },
  orderBy: { createdAt: 'asc' }
});
console.log(JSON.stringify(report, null, 2));
await prisma.$disconnect();
if (Object.values(report).some((value) => value && typeof value === 'object' && 'unowned' in value && value.unowned > 0)) {
  process.exitCode = 2;
}
