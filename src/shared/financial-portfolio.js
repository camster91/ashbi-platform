import { portfolioWhere } from './portfolio.js';

// Finance records may have no project. They remain visible in All work and
// Unclassified; a client shared across portfolios never supplies a portfolio.
export function financialPortfolioWhere(value) {
  if (value === 'UNCLASSIFIED') return { OR: [{ projectId: null }, { project: { portfolio: null } }] };
  return value ? { project: portfolioWhere(value) } : {};
}
