import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const board = {
  PENDING: [{ id: 't1', title: 'Packaging dieline', status: 'PENDING', priority: 'NORMAL' }],
  IN_PROGRESS: [{ id: 't2', title: 'Logo concepts round 2', status: 'IN_PROGRESS', priority: 'HIGH' }],
  BLOCKED: [],
  COMPLETED: [],
  WAITING_CLIENT: [{ id: 't3', title: 'Brand guidelines PDF', status: 'WAITING_CLIENT', priority: 'LOW' }],
  UPCOMING: [{ id: 't4', title: 'Accessibility audit', status: 'UPCOMING', priority: 'NORMAL' }],
  SOMETHING_NEW: [{ id: 't5', title: 'Legacy imported task', status: 'SOMETHING_NEW', priority: 'NORMAL' }],
};

const moveTask = vi.fn(async () => ({}));

vi.mock('../lib/api', () => ({
  api: {
    getKanbanBoard: vi.fn(async () => board),
    getProject: vi.fn(async () => ({ id: 'p1', name: 'Northwind Brand Refresh' })),
    moveTask: (...args) => moveTask(...args),
    createQuickTask: vi.fn(),
  },
}));

const { default: TaskKanban } = await import('../pages/TaskKanban');

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/project/p1/kanban']}>
        <Routes>
          <Route path="/project/:projectId/kanban" element={<TaskKanban />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Task kanban board', () => {
  beforeEach(() => moveTask.mockClear());

  it('shows every task, including statuses outside the four core columns', async () => {
    renderBoard();
    for (const title of ['Packaging dieline', 'Logo concepts round 2', 'Brand guidelines PDF', 'Accessibility audit', 'Legacy imported task']) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Waiting on client' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something New' })).toBeInTheDocument();
  });

  it('cards are keyboard focusable and move with the arrow keys, announcing the result', async () => {
    renderBoard();
    const card = await screen.findByRole('listitem', { name: /Packaging dieline/ });
    expect(card).toHaveAttribute('tabindex', '0');
    card.focus();
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t1', 'UPCOMING'));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved "Packaging dieline" to Upcoming.');
  });

  it('offers a labelled "Move to" control on every card', async () => {
    renderBoard();
    const card = await screen.findByRole('listitem', { name: /Logo concepts round 2/ });
    const select = within(card).getByRole('combobox', { name: 'Move "Logo concepts round 2" to column' });
    fireEvent.change(select, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t2', 'COMPLETED'));
  });
});
