import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProjectBudget from '../components/ProjectBudget';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { getProjectBudget: vi.fn() } }));
const caches = [];
const complete = () => ({ project: { budget: 1000, hourlyBudget: 10 }, time: { totalHours: 2, billableHours: 2 }, totalCost: 200,
  labor: { knownRateAmount: 200, missingRateEntries: 0, missingRateMinutes: 0 }, hoursPercentUsed: 20,
  expenses: { total: 25, count: 1, currencies: ['CAD'], mixedCurrency: false, unknownCurrencyCount: 0, byCurrency: { CAD: { total: 25, count: 1 } } },
  costByUser: [{ user: { id: 'u1', name: 'Known member' }, hours: 2, cost: 200 }], burnRate: 0 });
function setup() { const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache); render(<QueryClientProvider client={cache}><ProjectBudget projectId="project-a" budget={1000} hourlyBudget={10} /></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); api.getProjectBudget.mockResolvedValue(complete()); });
afterEach(() => { cleanup(); caches.splice(0).forEach(cache => cache.clear()); });
it('preserves known amounts without claiming a currency or financial percentage', async () => {
  setup(); await screen.findByRole('heading', { name: 'Budget Tracking' }); expect(screen.getByText('200.00')).toBeInTheDocument();
  expect(screen.getByText('Stored financial budget: 1,000.00 (currency unspecified)')).toBeInTheDocument(); expect(screen.getByText(/Financial usage is unavailable/)).toBeInTheDocument();
  expect(screen.getByText('20% of billable hours used')).toBeInTheDocument(); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20'); expect(document.body.textContent).not.toMatch(/\$/);
});
it('shows missing-rate totals as unavailable and retains an explicitly incomplete known subtotal', async () => {
  const r = complete(); r.totalCost = null; r.labor.missingRateEntries = 1; r.labor.missingRateMinutes = 30; r.costByUser.push({ user: { id: 'u2', name: 'Unpriced member' }, hours: 0.5, cost: null });
  api.getProjectBudget.mockResolvedValue(r); setup(); expect(await screen.findByText('Unavailable — missing time rates')).toBeInTheDocument();
  expect(screen.getByText(/1 time entry has no valid recorded rate \(0.5h\)/)).toHaveTextContent('Known-rate subtotal: 200.00'); expect(screen.getByText(/0.5h — Unavailable — missing rate/)).toBeInTheDocument(); expect(screen.queryByText('0.00')).not.toBeInTheDocument();
});
it('shows CAD and USD separately and excludes unknown currency from totals', async () => {
  const r = complete(); r.expenses = { total: null, count: 3, currencies: ['CAD', 'USD'], mixedCurrency: true, unknownCurrencyCount: 1, byCurrency: { CAD: { total: 25, count: 1 }, USD: { total: 30, count: 1 } } };
  api.getProjectBudget.mockResolvedValue(r); setup(); expect(await screen.findByText('CAD: 25.00')).toBeInTheDocument(); expect(screen.getByText('USD: 30.00')).toBeInTheDocument(); expect(screen.getByText(/no conversion or combined total/)).toBeInTheDocument(); expect(screen.getByText(/1 expense has an unknown currency/)).toBeInTheDocument(); expect(screen.queryByText(/55.00/)).not.toBeInTheDocument();
});
it('distinguishes genuine zero amounts from unavailable rates and empty expenses', async () => {
  const r = complete(); r.totalCost = 0; r.costByUser = []; r.expenses = { count: 0, total: 0, currencies: [], byCurrency: {} }; api.getProjectBudget.mockResolvedValue(r); setup();
  await screen.findByText('No recorded expenses.'); expect(screen.getByText('0.00')).toBeInTheDocument(); expect(screen.queryByText('Unavailable — missing time rates')).not.toBeInTheDocument();
});
it('omits the percentage when hours budget is unset', async () => {
  const r = complete(); r.project.hourlyBudget = 0; r.hoursPercentUsed = null; api.getProjectBudget.mockResolvedValue(r); setup(); await screen.findByRole('heading', { name: 'Budget Tracking' }); expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(); expect(screen.queryByText('0% of billable hours used')).not.toBeInTheDocument();
});
it('retains over-budget hourly progress while clamping the visual meter', async () => {
  const r = complete(); r.hoursPercentUsed = 125; api.getProjectBudget.mockResolvedValue(r); setup(); await screen.findByText('125% of billable hours used'); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100'); expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '125% of billable hours used');
});
it('offers retry after a read failure instead of silently hiding the section', async () => {
  api.getProjectBudget.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce(complete()); setup(); await screen.findByText('Project budget could not be loaded'); fireEvent.click(screen.getByRole('button', { name: 'Retry', exact: true })); await screen.findByRole('heading', { name: 'Budget Tracking' }); expect(api.getProjectBudget).toHaveBeenCalledTimes(2);
});

it('preserves authoritative null budgets rather than substituting stale page props', async () => {
  const r = complete(); r.project = { budget: null, hourlyBudget: null }; r.hoursPercentUsed = null;
  api.getProjectBudget.mockResolvedValue(r); setup(); await screen.findByRole('heading', { name: 'Budget Tracking' });
  expect(screen.queryByText(/Stored financial budget:/)).not.toBeInTheDocument();
  expect(screen.queryByText('Hourly Budget')).not.toBeInTheDocument(); expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});
