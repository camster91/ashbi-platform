import { portfolioWhere } from './portfolio.js';

// Finance records may have no project. They remain visible in All work and
// Unclassified; a client shared across portfolios never supplies a portfolio.
export function financialPortfolioWhere(value) {
  if (value === 'UNCLASSIFIED') return { OR: [{ projectId: null }, { project: { portfolio: null } }] };
  return value ? { project: portfolioWhere(value) } : {};
}

// Invoice.projectId is a scalar reference in the existing schema. Resolve the
// authorized project identities instead of querying a nonexistent relation.
export async function invoicePortfolioWhere(prisma, value, organizationId) {
  if (!value) return {};
  const ids = [];
  let after;
  for (;;) {
    const rows = await prisma.project.findMany({ where: { ...portfolioWhere(value), ...(organizationId ? { organizationId } : {}), deletedAt: {}, ...(after ? { id: { gt: after } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    ids.push(...rows.map(row => row.id));
    if (rows.length < 100) break;
    after = rows.at(-1).id;
  }
  return value === 'UNCLASSIFIED' ? { OR: [{ projectId: null }, { projectId: { in: ids } }] } : { projectId: { in: ids } };
}
