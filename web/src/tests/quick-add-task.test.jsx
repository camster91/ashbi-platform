import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import QuickAdd from '../components/QuickAdd';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getProjects: vi.fn(), createQuickTask: vi.fn() } }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [], isFetching: false }) }));

it('opens on Task and creates only in the explicitly selected project', async () => {
  api.getProjects.mockResolvedValue({ projects: [{ id: 'project-a', name: 'Alpha' }, { id: 'project-b', name: 'Beta' }] });
  api.createQuickTask.mockResolvedValue({ id: 'task-1' });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  render(<MemoryRouter><QueryClientProvider client={client}><QuickAdd open initialTab="task" onClose={vi.fn()} /></QueryClientProvider></MemoryRouter>);
  expect(screen.getByRole('button', { name: 'Task', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const title = screen.getByRole('textbox', { name: 'Task title' });
  await user.type(title, 'QA task');
  expect(screen.getByRole('button', { name: 'Create Task' })).toBeDisabled();
  await screen.findByRole('option', { name: 'Beta' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'project-b');
  await user.click(screen.getByRole('button', { name: 'Create Task' }));
  await waitFor(() => expect(api.createQuickTask).toHaveBeenCalledWith('project-b', { title: 'QA task', status: 'PENDING' }));
  expect(await screen.findByText('Task created.')).toBeVisible();
});
