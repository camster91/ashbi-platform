import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getDashboardStats: vi.fn(async () => ({
      mrr: 0,
      activeRetainerCount: 0,
      totalOutstanding: 0,
      outstandingCount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      draftInvoiceTotal: 12204,
      draftInvoiceCount: 2,
      activeProjects: 2,
      pendingApprovals: 0,
      recentActivity: [],
      unreadNotifications: [],
      clientHealth: [],
    })),
    getMyTasks: vi.fn(async () => []),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Cameron Ashley', role: 'ADMIN' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ notifications: [] }) }));
vi.mock('../components/widgets/TimeTrackerWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/UpcomingEventsWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/OutreachFunnelWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/RevenueSparklineWidget', () => ({ default: () => null }));

const { default: Dashboard } = await import('../pages/Dashboard');
const { api } = await import('../lib/api');

describe('Dashboard KPIs', () => {
  it('explains a zero outstanding balance next to unsent drafts, and a zero MRR', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </QueryClientProvider>,
    );
    const outstanding = await screen.findByRole('button', { name: /Outstanding \(sent\)/ });
    expect(outstanding).toHaveTextContent('$0');
    expect(outstanding).toHaveTextContent('Drafts $12.2K · 2 not sent');
    expect(screen.getByRole('button', { name: /MRR/ })).toHaveTextContent('No active retainers');
    expect(screen.getByRole('button', { name: /New Invoice/ })).toHaveClass('focus-visible:ring-2');
  });

  it('shows MRR from CAD retainers in CAD, not US$0', async () => {
    const base = await api.getDashboardStats();
    api.getDashboardStats.mockResolvedValueOnce({
      ...base, mrr: 4500, mrrCurrency: 'CAD', mrrByCurrency: { CAD: 4500 }, activeRetainerCount: 2,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><Dashboard /></MemoryRouter>
      </QueryClientProvider>,
    );
    const mrr = await screen.findByRole('button', { name: /MRR/ });
    await waitFor(() => expect(mrr).toHaveTextContent('$4.5K'));
    expect(mrr).not.toHaveTextContent('US$');
    expect(mrr).toHaveTextContent('2 active retainers');
  });
});
