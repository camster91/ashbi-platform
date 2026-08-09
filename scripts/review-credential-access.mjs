import { rawPrisma } from '../src/config/db.js';

const sinceArg = process.argv.indexOf('--since-hours');
const sinceHours = sinceArg >= 0 ? Number(process.argv[sinceArg + 1]) : 24;
if (!Number.isFinite(sinceHours) || sinceHours <= 0 || sinceHours > 24 * 90) {
  console.error('--since-hours must be between 1 and 2160');
  process.exitCode = 1;
} else {
  try {
    const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const [total, byOutcome, byActor, byPurpose] = await Promise.all([
      rawPrisma.credentialAccessAudit.count({ where: { createdAt: { gte: since } } }),
      rawPrisma.credentialAccessAudit.groupBy({
        by: ['outcome'], where: { createdAt: { gte: since } }, _count: { _all: true },
      }),
      rawPrisma.credentialAccessAudit.groupBy({
        by: ['actorUserId'], where: { createdAt: { gte: since } }, _count: { _all: true },
      }),
      rawPrisma.credentialAccessAudit.groupBy({
        by: ['purpose'], where: { createdAt: { gte: since } }, _count: { _all: true },
      }),
    ]);
    console.log(JSON.stringify({
      since: since.toISOString(),
      total,
      byOutcome: Object.fromEntries(byOutcome.map((row) => [row.outcome, row._count._all])),
      byActor: Object.fromEntries(byActor.map((row) => [row.actorUserId, row._count._all])),
      byPurpose: Object.fromEntries(byPurpose.map((row) => [row.purpose, row._count._all])),
    }));
  } finally {
    await rawPrisma.$disconnect();
  }
}
