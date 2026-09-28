import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const initialBoard = () => ({
  PENDING: [{ id: 't1', title: 'Packaging dieline', status: 'PENDING', priority: 'NORMAL' }],
  IN_PROGRESS: [{ id: 't2', title: 'Logo concepts round 2', status: 'IN_PROGRESS', priority: 'HIGH' }],
  BLOCKED: [],
  COMPLETED: [],
  WAITING_CLIENT: [{ id: 't3', title: 'Brand guidelines PDF', status: 'WAITING_CLIENT', priority: 'LOW' }],
  UPCOMING: [{ id: 't4', title: 'Accessibility audit', status: 'UPCOMING', priority: 'NORMAL' }],
  SOMETHING_NEW: [{ id: 't5', title: 'Legacy imported task', status: 'SOMETHING_NEW', priority: 'NORMAL' }],
});

let board = initialBoard();
const moveTask = vi.fn(async (taskId, status) => {
  const all = Object.values(board).flat();
  const task = all.find((t) => t.id === taskId);
  const next = Object.fromEntries(Object.entries(board).map(([k, list]) => [k, list.filter((t) => t.id !== taskId)]));
  next[status] = [...(next[status] || []), { ...task, status }];
  board = next;
  return {};
});

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

const cardFor = async (title) => (await screen.findByText(title)).closest('li');

function setViewportWide(wide) {
  window.matchMedia = (query) => ({
    matches: query === '(min-width: 1024px)' ? wide : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}

describe('Task kanban board', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    board = initialBoard();
    moveTask.mockClear();
    setViewportWide(true);
  });
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('shows every task, including statuses outside the four core columns', async () => {
    renderBoard();
    for (const title of ['Packaging dieline', 'Logo concepts round 2', 'Brand guidelines PDF', 'Accessibility audit', 'Legacy imported task']) {
      expect(await screen.findByText(title)).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { name: 'Waiting on client' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Upcoming' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Something New' })).toBeInTheDocument();
  });

  it('cards keep their content as the name and describe their column', async () => {
    renderBoard();
    const card = await cardFor('Packaging dieline');
    expect(card).not.toHaveAttribute('aria-label');
    expect(card).toHaveAccessibleDescription(/In column To Do\..*arrow key/);
  });

  it('moves with the arrow keys, announces it and keeps focus on the moved card', async () => {
    renderBoard();
    const card = await cardFor('Packaging dieline');
    expect(card).toHaveAttribute('tabindex', '0');
    act(() => card.focus());
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t1', 'UPCOMING'));
    expect(await screen.findByRole('status')).toHaveTextContent('Moved "Packaging dieline" to Upcoming.');
    await waitFor(() => {
      const moved = document.querySelector('[data-task-id="t1"]');
      expect(moved).toHaveAttribute('data-status', 'UPCOMING');
      expect(moved).toHaveFocus();
    });
  });

  it('uses Up/Down for the previous/next column only when columns are stacked', async () => {
    setViewportWide(true);
    renderBoard();
    let card = await cardFor('Packaging dieline');
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    expect(moveTask).not.toHaveBeenCalled();

    setViewportWide(false);
    card = await cardFor('Packaging dieline');
    fireEvent.keyDown(card, { key: 'ArrowDown' });
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t1', 'UPCOMING'));
  });

  it('offers a labelled "Move to" control on every card', async () => {
    renderBoard();
    const card = await cardFor('Logo concepts round 2');
    const select = within(card).getByRole('combobox', { name: 'Move "Logo concepts round 2" to column' });
    fireEvent.change(select, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(moveTask).toHaveBeenCalledWith('t2', 'COMPLETED'));
  });
});
