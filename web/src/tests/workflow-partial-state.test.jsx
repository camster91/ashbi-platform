import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PartialSectionNotice from '../components/PartialSectionNotice';
import Dashboard from '../pages/Dashboard';
import Project from '../pages/Project';
import { ToastProvider } from '../hooks/useToast';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getDashboardStats: vi.fn(),
    getMyTasks: vi.fn(),
    getProject: vi.fn(),
    getRevisions: vi.fn(),
    getTaskTemplates: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam Staff', role: 'STAFF' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ notifications: [] }) }));
vi.mock('../components/widgets/TimeTrackerWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/UpcomingEventsWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/OutreachFunnelWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/RevenueSparklineWidget', () => ({ default: () => null }));
vi.mock('../components/project/ProjectCommunications', () => ({ default: () => null }));
vi.mock('../components/project/ProjectContext', () => ({ default: () => null }));
vi.mock('../components/project/ProjectMedia', () => ({ default: () => null }));
vi.mock('../components/ProjectChat', () => ({ default: () => null }));

function renderPage(ui, path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('PartialSectionNotice', () => {
  it('names the failed section, keeps a polite status, and retries only that read', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<PartialSectionNotice section="Revision rounds" error={{ status: 503 }} onRetry={onRetry} />);

    const notice = screen.getByRole('status');
    expect(notice).toHaveAttribute('aria-live', 'polite');
    expect(notice).toHaveTextContent('Revision rounds is temporarily unavailable');
    expect(notice).toHaveTextContent('Everything else on this page loaded');
    await user.click(screen.getByRole('button', { name: 'Retry Revision rounds' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('disables duplicate retries while retrying', () => {
    render(<PartialSectionNotice section="Task data" onRetry={() => {}} isRetrying />);
    expect(screen.getByRole('button', { name: 'Retrying Task data' })).toBeDisabled();
  });
});

describe('Dashboard partial state', () => {
  it('keeps loaded dashboard sections visible when tasks fail and retries only tasks', async () => {
    const user = userEvent.setup();
    api.getDashboardStats.mockResolvedValue({ projects: { active: 7 } });
    api.getMyTasks
      .mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 503 }))
      .mockResolvedValueOnce({ today: [{ id: 't1', title: 'Write brief' }] });

    renderPage(<Dashboard />);

    expect(await screen.findByText('Task data is temporarily unavailable')).toBeInTheDocument();
    // Loaded sections stay visible alongside the notice.
    expect(screen.getByRole('heading', { name: 'Activity Feed' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    const statsCalls = api.getDashboardStats.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Retry Task data' }));

    await waitFor(() => expect(screen.queryByText('Task data is temporarily unavailable')).not.toBeInTheDocument());
    expect(api.getMyTasks).toHaveBeenCalledTimes(2);
    expect(api.getDashboardStats).toHaveBeenCalledTimes(statsCalls);
    expect(await screen.findByText('Write brief')).toBeInTheDocument();
  });
});

describe('Project partial state', () => {
  it('shows the project with an inline, retryable notice when revision rounds fail', async () => {
    const user = userEvent.setup();
    api.getProject.mockResolvedValue({
      id: 'p1', name: 'Website refresh', status: 'ACTIVE', health: 'ON_TRACK', tasks: [], threads: [], client: { id: 'c1', name: 'Acme' },
    });
    api.getRevisions
      .mockRejectedValueOnce(Object.assign(new Error('down'), { status: 500 }))
      .mockResolvedValueOnce([]);

    renderPage(
      <Routes><Route path="/project/:id" element={<Project />} /></Routes>,
      '/project/p1',
    );

    expect(await screen.findByText('Revision rounds is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Website refresh' })).toBeInTheDocument();
    const projectCalls = api.getProject.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Retry Revision rounds' }));

    await waitFor(() => expect(screen.queryByText('Revision rounds is temporarily unavailable')).not.toBeInTheDocument());
    expect(api.getRevisions).toHaveBeenCalledTimes(2);
    expect(api.getProject).toHaveBeenCalledTimes(projectCalls);
  });
});
