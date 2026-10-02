import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import Portal, { PORTAL_TASK_GROUPS, groupPortalTasks } from '../pages/Portal';
import { CLIENT_TASK_COLUMN_STATUSES } from '@shared/client-task-columns.js';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getPortal: vi.fn() } }));

describe('groupPortalTasks', () => {
  it('uses the API board columns (every open status, in exactly one group)', () => {
    const { DONE, ...openColumns } = CLIENT_TASK_COLUMN_STATUSES;
    expect(DONE).toEqual(['COMPLETED']);
    expect(Object.fromEntries(PORTAL_TASK_GROUPS.map((g) => [g.key, [...g.statuses]])))
      .toEqual(Object.fromEntries(Object.entries(openColumns).map(([k, v]) => [k, [...v]])));
    expect(PORTAL_TASK_GROUPS[0]).toMatchObject({ key: 'WAITING_CLIENT', label: 'Waiting on you' });
  });

  it('maps internal statuses to the client board groups', () => {
    const groups = groupPortalTasks([
      { title: 'a', status: 'WAITING_US' },
      { title: 'b', status: 'WAITING_CLIENT' },
      { title: 'c', status: 'PENDING' },
      { title: 'd', status: 'LEGACY_THING' },
    ]);
    expect(groups.IN_PROGRESS.map((t) => t.title)).toEqual(['a']);
    expect(groups.WAITING_CLIENT.map((t) => t.title)).toEqual(['b']);
    expect(groups.TODO.map((t) => t.title)).toEqual(['c', 'd']);
  });
});

describe('Portal project link page', () => {
  it('uses client-facing labels and always shows a "Waiting on you" group', async () => {
    api.getPortal.mockResolvedValue({
      name: 'Website', status: 'DESIGN_DEV', milestones: [], revisionRounds: [],
      activeTasks: [
        { title: 'Build header', status: 'WAITING_US' },
        { title: 'Approve logo', status: 'WAITING_CLIENT' },
      ],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/portal/tok']}>
          <Routes><Route path="/portal/:token" element={<Portal />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const waiting = await screen.findByRole('region', { name: /Waiting on you/ });
    expect(within(waiting).getByText('Approve logo')).toBeInTheDocument();
    const inProgress = screen.getByRole('region', { name: /In Progress/ });
    expect(within(inProgress).getByText('Build header')).toBeInTheDocument();
    expect(screen.queryByText(/waiting us/i)).toBeNull();
    expect(screen.queryByText(/waiting client/i)).toBeNull();
  });
});
