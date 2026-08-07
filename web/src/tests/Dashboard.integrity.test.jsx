import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../pages/Dashboard';

const navigate = vi.fn();
let dashboardStats;
let dashboardError = false;
let tasksError = false;

vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: Symbol('keepPreviousData'),
  useQuery: ({ queryKey }) => queryKey[0] === 'dashboard-stats'
    ? { data: dashboardStats, isLoading: false, isError: dashboardError, failureCount: dashboardError ? 3 : 0 }
    : { data: [], isError: tasksError },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { name: 'Cam', role: 'ADMIN' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ notifications: [] }) }));
vi.mock('../components/widgets/TimeTrackerWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/UpcomingEventsWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/OutreachFunnelWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/RevenueSparklineWidget', () => ({ default: () => null }));
vi.mock('../components/widgets/WPSiteHealthWidget', () => ({ default: () => null }));

const emptyStats = {
  unreadNotifications: [],
  recentActivity: [],
  atRiskProjects: [],
  inboxTriage: { untriagedCount: 0, latest: [] },
  wpSiteAlerts: [],
  overdueTasks: [],
};

function renderDashboard() {
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
}

describe('Dashboard data integrity', () => {
  beforeEach(() => {
    navigate.mockClear();
    dashboardStats = emptyStats;
    dashboardError = false;
    tasksError = false;
  });

  it('renders truthful empty states without named demo records', () => {
    renderDashboard();

    expect(screen.getByText('All projects on track')).toBeInTheDocument();
    expect(screen.getByText(/Inbox is clear/)).toBeInTheDocument();
    expect(screen.queryByText('SSCA Website')).not.toBeInTheDocument();
    expect(screen.queryByText('Numan Redesign')).not.toBeInTheDocument();
    expect(screen.queryByText('wellingtonquarters.ca')).not.toBeInTheDocument();
    expect(screen.queryByText('Finalize SSCA mobile nav')).not.toBeInTheDocument();
  });

  it('uses registered destinations for revenue and project details', () => {
    dashboardStats = {
      ...emptyStats,
      atRiskProjects: [{ id: 'project-1', name: 'Real project', health: 'AT_RISK', healthScore: 40, blockedTasks: [] }],
    };
    renderDashboard();

    fireEvent.click(screen.getByText('MRR'));
    expect(navigate).toHaveBeenCalledWith('/invoices');

    fireEvent.click(screen.getByText('Real project'));
    expect(navigate).toHaveBeenCalledWith('/project/project-1');
  });

  it('uses registered destinations for activity and client details', () => {
    dashboardStats = {
      ...emptyStats,
      clientHealth: [{ id: 'client-1', name: 'Real client', healthStatus: 'ON_TRACK', healthScore: 90 }],
    };
    renderDashboard();

    expect(screen.getAllByRole('link', { name: 'View all' })[0]).toHaveAttribute('href', '/inbox');
    fireEvent.click(screen.getByRole('button', { name: 'View client health for Real client' }));
    expect(navigate).toHaveBeenCalledWith('/client/client-1');
  });

  it('distinguishes a dashboard failure from a successful empty response', () => {
    dashboardStats = undefined;
    dashboardError = true;
    renderDashboard();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load dashboard stats');
    expect(screen.queryByText(/Showing default data/)).not.toBeInTheDocument();
  });

  it('reports a partial task failure while preserving available dashboard data', () => {
    tasksError = true;
    renderDashboard();

    expect(screen.getByRole('status')).toHaveTextContent('Task data is temporarily unavailable');
    expect(screen.getByText('All projects on track')).toBeInTheDocument();
  });
});
