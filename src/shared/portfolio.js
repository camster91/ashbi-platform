// A portfolio classifies work inside one organization; it is never an access boundary.
export const PORTFOLIO_VALUES = ['ASHBI_DESIGN', 'FREELANCE'];
export const PORTFOLIO_OPTIONS = [
  { value: 'ASHBI_DESIGN', label: 'Ashbi Design' },
  { value: 'FREELANCE', label: 'Freelance' },
];
export function portfolioWhere(value) {
  return value === 'UNCLASSIFIED' ? { portfolio: null } : value ? { portfolio: value } : {};
}
