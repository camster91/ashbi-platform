import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { LoadingState } from './ui';
import QueryErrorState from './QueryErrorState';
const amount = value => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hours = value => Number.isFinite(value) ? value.toFixed(1) : 'Unknown';

export default function ProjectBudget({ projectId, budget, hourlyBudget }) {
  const { data, isPending, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['project-budget', projectId], queryFn: () => api.getProjectBudget(projectId),
  });
  if (isPending) return <LoadingState label="Loading project budget…" compact />;
  if (isError) return <QueryErrorState error={error} message="Project budget could not be loaded" onRetry={refetch} isRetrying={isFetching} />;
  if (!data) return null;
  const storedBudget = data.project ? data.project.budget : budget;
  const storedHours = data.project ? data.project.hourlyBudget : hourlyBudget;
  const pct = data.hoursPercentUsed;
  const currencies = data.expenses?.currencies ?? [];
  return <section aria-label="Project budget" className="rounded-xl border border-border bg-card">
    <div className="flex items-center justify-between border-b border-border px-5 py-4">
      <h3 className="font-semibold">Budget Tracking</h3>
      {Number.isFinite(pct) && <span className="text-sm">{pct}% of billable hours used</span>}
    </div>
    <div className="space-y-4 p-5">
      <p role="status" className="text-sm text-muted-foreground">Financial usage is unavailable: project budget and time-rate currencies are unspecified. Recorded rate amounts are not verified costs or profit.</p>
      {Number.isFinite(storedBudget) && <p className="text-sm">Stored financial budget: {amount(storedBudget)} (currency unspecified)</p>}
      {storedHours > 0 && <div>
        <div className="mb-1 flex justify-between text-sm"><span>Hourly Budget</span><span>{hours(data.time?.billableHours)}h / {storedHours}h</span></div>
        {Number.isFinite(pct) && <div role="progressbar" aria-label="Billable hours budget" aria-valuenow={Math.max(0, Math.min(pct, 100))} aria-valuemin={0} aria-valuemax={100} aria-valuetext={`${pct}% of billable hours used`} className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary motion-safe:transition-all" style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} /></div>}
      </div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Total Hours</p><p>{hours(data.time?.totalHours)}</p></div>
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Billable Hours</p><p>{hours(data.time?.billableHours)}</p></div>
        <div className="rounded-lg bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Recorded rate amount</p><p>{Number.isFinite(data.totalCost) ? amount(data.totalCost) : 'Unavailable — missing time rates'}</p><p className="text-xs text-muted-foreground">Currency unspecified</p></div>
      </div>
      {data.labor?.missingRateEntries > 0 && <p role="status" className="text-sm">{data.labor.missingRateEntries} time {data.labor.missingRateEntries === 1 ? 'entry has' : 'entries have'} no valid recorded rate ({hours(data.labor.missingRateMinutes / 60)}h). Known-rate subtotal: {amount(data.labor.knownRateAmount)} (currency unspecified).</p>}
      <div><h4 className="text-sm font-medium">Expenses by currency</h4>
        {data.expenses?.count === 0 && <p className="text-sm text-muted-foreground">No recorded expenses.</p>}
        {currencies.map(currency => <p key={currency} className="text-sm">{currency}: {amount(data.expenses.byCurrency[currency].total)}</p>)}
        {data.expenses?.mixedCurrency && <p className="text-sm text-muted-foreground">Expense currencies are shown separately; no conversion or combined total is applied.</p>}
        {data.expenses?.unknownCurrencyCount > 0 && <p role="status" className="text-sm">{data.expenses.unknownCurrencyCount} {data.expenses.unknownCurrencyCount === 1 ? 'expense has' : 'expenses have'} an unknown currency and are excluded from currency totals.</p>}
      </div>
      {data.costByUser?.length > 0 && <div><h4 className="mb-2 text-sm font-medium">Recorded rate amounts by team member</h4><div className="space-y-2">{data.costByUser.map((row, index) => <div key={row.user?.id ?? index} className="flex justify-between gap-2 text-sm"><span>{row.user?.name ?? 'Unknown member'}</span><span>{hours(row.hours)}h — {Number.isFinite(row.cost) ? amount(row.cost) : 'Unavailable — missing rate'} (currency unspecified)</span></div>)}</div></div>}
      {data.burnRate > 0 && <p className="text-sm text-muted-foreground">Burn rate: {data.burnRate.toFixed(1)} hours/day over last 30 days</p>}
    </div>
  </section>;
}
