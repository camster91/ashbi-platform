import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { formatMoney } from '../lib/format';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { user: { id: 'u1', name: 'Cameron Ashley', role: 'ADMIN' } };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOW = new Date();
const THIS_MONTH = MONTHS[NOW.getMonth()];
const LAST_MONTH = MONTHS[(NOW.getMonth() + 11) % 12];

vi.mock('../lib/api', () => ({
  api: {
    getDashboardStats: vi.fn(),
    getMyTasks: vi.fn(async () => ({ IMMEDIATE: [{ id: 'task-a', title: 'Send homepage draft', project: { name: 'Harbour Hotel' } }] })),
    getAiToolApprovals: vi.fn(),
    getInvoices: vi.fn(),
    approveAiToolAction: vi.fn(),
    rejectAiToolAction: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ notifications: [] }) }));
vi.mock('../components/widgets/TimeTrackerWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/UpcomingEventsWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/OutreachFunnelWidget', () => ({ default: () => null }));

const { default: Dashboard } = await import('../pages/Dashboard');
const { api } = await import('../lib/api');

const baseStats = {
  mrr: 0,
  activeRetainerCount: 0,
  totalOutstanding: 3600,
  outstandingCount: 2,
  overdueAmount: 850,
  overdueCount: 1,
  draftInvoiceTotal: 0,
  draftInvoiceCount: 0,
  activeProjects: 3,
  pendingApprovals: 2,
  recentActivity: [],
  unreadNotifications: [],
  clientHealth: [],
  revenueHistory: [
    { month: LAST_MONTH, year: String(NOW.getMonth() === 0 ? NOW.getFullYear() - 1 : NOW.getFullYear()), total: 10900 },
    { month: THIS_MONTH, year: String(NOW.getFullYear()), total: 12800 },
  ],
};

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Dashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Dashboard redesign', () => {
  beforeEach(() => {
    authState.user = { id: 'u1', name: 'Cameron Ashley', role: 'ADMIN' };
    api.getDashboardStats.mockResolvedValue(baseStats);
    api.getAiToolApprovals.mockResolvedValue({
      approvals: [{
        id: 'action-a',
        tool: 'create_task',
        preview: { title: 'Fix checkout button', project: { name: 'Northwind Coffee' } },
        requesterName: 'Claude bridge',
        source: 'ai_bridge',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }],
    });
    api.getInvoices.mockResolvedValue({
      invoices: [
        { id: 'inv-1', invoiceNumber: 'INV-1040', status: 'SENT', isOverdue: true, total: 3350, currency: 'CAD', dueDate: '2026-10-10', client: { name: 'Brightpath Law' } },
        { id: 'inv-2', invoiceNumber: 'INV-1038', status: 'PAID', isOverdue: false, total: 1150, currency: 'CAD', dueDate: '2026-10-15', client: { name: 'Maple Dental' } },
      ],
      total: 2,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('greets by first name in an italic accent', async () => {
    renderDashboard();
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent(/Good (morning|afternoon|evening), Cameron/);
  });

  it('shows money at a glance, with paid this month from the current month only', async () => {
    renderDashboard();
    const paid = await screen.findByRole('button', { name: /Paid this month/ });
    expect(paid).toHaveTextContent('$12.8K');
    expect(screen.getByRole('button', { name: /Overdue/ })).toHaveTextContent('1 invoice past due');
    expect(screen.getByRole('button', { name: /Owed to you/ })).toHaveTextContent('2 sent, unpaid invoices');
  });

  it('never adds CAD and USD together in paid this month or the chart', async () => {
    api.getDashboardStats.mockResolvedValue({
      ...baseStats,
      revenueHistory: [
        { month: LAST_MONTH, year: String(NOW.getMonth() === 0 ? NOW.getFullYear() - 1 : NOW.getFullYear()), total: 5000, byCurrency: { CAD: 5000 } },
        { month: THIS_MONTH, year: String(NOW.getFullYear()), total: 1300, byCurrency: { CAD: 1000, USD: 300 } },
      ],
    });
    renderDashboard();
    const paid = await screen.findByRole('button', { name: /Paid this month/ });
    // Built with the app's formatter: compact output differs between ICU builds.
    const cad = formatMoney(1000, 'CAD', { compact: true });
    const usd = formatMoney(300, 'USD', { compact: true });
    expect(paid).toHaveTextContent(`${cad} · ${usd}`);
    expect(paid).not.toHaveTextContent(formatMoney(1300, 'CAD', { compact: true }));
    const chart = screen.getByRole('img', { name: /Paid per month/ });
    expect(chart.getAttribute('aria-label')).toContain(`${THIS_MONTH} ${cad}`);
    expect(screen.getByText(`Shown in CAD. Also paid: ${usd}.`)).toBeInTheDocument();
  });

  it('lists agent actions and drafted replies waiting for approval', async () => {
    renderDashboard();
    const panel = await screen.findByRole('region', { name: /Waiting for your OK/ });
    expect(await within(panel).findByRole('button', { name: /Approve Create task: “Fix checkout button” in Northwind Coffee/ })).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /2 client replies/ })).toHaveAttribute('href', '/approvals');
  });

  it('says plainly when nothing is waiting', async () => {
    api.getDashboardStats.mockResolvedValue({ ...baseStats, pendingApprovals: 0 });
    api.getAiToolApprovals.mockResolvedValue({ approvals: [] });
    renderDashboard();
    expect(await screen.findByText(/Nothing waiting/)).toBeInTheDocument();
  });

  it('shows recent invoices with their display status', async () => {
    renderDashboard();
    const table = await screen.findByRole('table');
    expect(api.getInvoices).toHaveBeenCalledWith({ limit: 5, sort: 'createdAt', order: 'desc' });
    expect(await within(table).findByRole('link', { name: 'INV-1040' })).toHaveAttribute('href', '/invoices/inv-1');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Overdue');
    expect(rows[2]).toHaveTextContent('Paid');
  });

  it('keeps money panels and invoice requests away from team members', async () => {
    authState.user = { id: 'u2', name: 'Bianca Ashley', role: 'TEAM' };
    renderDashboard();
    expect(await screen.findByRole('button', { name: /Active projects/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Owed to you/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(api.getInvoices).not.toHaveBeenCalled();
  });

  it('does not ask client users for agent actions', async () => {
    authState.user = { id: 'u3', name: 'Priya Shah', role: 'CLIENT' };
    renderDashboard();
    await screen.findByRole('heading', { level: 1 });
    expect(api.getAiToolApprovals).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: /Waiting for your OK/ })).not.toBeInTheDocument();
  });
});
