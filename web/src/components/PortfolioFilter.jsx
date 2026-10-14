import { PORTFOLIO_OPTIONS } from '@shared/portfolio.js';

export default function PortfolioFilter({ value, onChange, disabled = false }) {
  return <label className="text-sm">Work portfolio<select aria-label="Work portfolio" value={value} disabled={disabled} onChange={event => onChange(event.target.value)} className="block min-h-11 max-w-full rounded border border-border bg-card px-3">
    <option value="">All work</option>{PORTFOLIO_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}<option value="UNCLASSIFIED">Unclassified</option>
  </select></label>;
}
