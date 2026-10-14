import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi } from 'vitest';
import TaskBoardMembership from '../components/TaskBoardMembership';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getProjectBoards: vi.fn(async () => ({ items: [{ id: 'DEFAULT', name: 'Project board' }, { id: 'b1', name: 'Delivery' }, { id: 'old', name: 'Retired', archivedAt: '2026-01-01' }], nextCursor: null })), moveTaskBoard: vi.fn(), getTaskPage: vi.fn() } }));
it('keeps the captured membership revision and draft through conflicts and failed reloads', async () => {
  api.moveTaskBoard.mockRejectedValueOnce(new Error('Conflict'));
  api.getTaskPage.mockRejectedValueOnce(new Error('Offline'));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const task = { id: 'task', projectId: 'project', boardId: null, boardMembershipRevision: 3 };
  const view = task => <QueryClientProvider client={cache}><TaskBoardMembership task={task} /></QueryClientProvider>;
  const rendered = render(view(task));
  await screen.findByRole('option', { name: 'Delivery' });
  expect(screen.getByRole('option', { name: 'Retired (archived)' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Destination board'), { target: { value: 'b1' } });
  rendered.rerender(view({ ...task, boardMembershipRevision: 4 }));
  fireEvent.click(screen.getByRole('button', { name: 'Move to board' }));
  await waitFor(() => expect(api.moveTaskBoard).toHaveBeenCalledWith('task', { projectId: 'project', revision: 3, boardId: 'b1' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reload membership and discard draft' }));
  expect(await screen.findByText(/Your selection is retained/)).toBeInTheDocument();
  expect(screen.getByLabelText('Destination board')).toHaveValue('b1');
});
