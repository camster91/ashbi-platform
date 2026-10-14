import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import Team from '../pages/Team';

const rows = [
  { id: 'one', name: 'One', role: 'TEAM', skills: [], isActive: true, activeThreads: 3, activeTasks: 123, contributedTasks: 5, weeklyHours: 50, utilizationPercent: 125, utilization: 125, status: 'overloaded', projects: [] },
  { id: 'two', name: 'Two', role: 'TEAM', skills: [], isActive: true, activeThreads: 0, activeTasks: 0, contributedTasks: 0, weeklyHours: 1, utilizationPercent: null, utilization: null, status: 'unconfigured', projects: [] },
];
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { role: 'TEAM' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../lib/api', () => ({ api: { getTeam: async () => rows, getWorkload: async () => rows, getTeamAllocations: async () => ({ allocations: rows }) } }));

it('shows honest logged capacity, separate contributions and an average excluding unset capacity', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Team /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('123 owned tasks · 5 contributions')).toBeInTheDocument();
  expect(screen.getByText('125%')).toBeInTheDocument();
  expect(screen.getByText('Set capacity')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resources' }));
  expect(await screen.findByText('Avg logged time / capacity')).toBeInTheDocument();
  expect(screen.getAllByText('125%')).toHaveLength(2);
  expect(screen.getByText('Set capacity')).toBeInTheDocument();
});
