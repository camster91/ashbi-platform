import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import WorkspacePageAccess from '../components/WorkspacePageAccess';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { getWorkspacePageAccess: vi.fn(), getWorkspacePageAccessOptions: vi.fn(), saveWorkspacePageAccess: vi.fn() } }));

it('retains the observed access revision across refetch and failed reload while paging staff choices', async () => {
  let current = { revision: 4, mode: 'TEAM', members: [] };
  api.getWorkspacePageAccess.mockImplementation(async () => current);
  api.getWorkspacePageAccessOptions.mockImplementation(async (_id, input) => input.after ? { items: [{ id: 'later', name: 'Bianca' }], nextCursor: null } : { items: [{ id: 'first', name: 'Cameron' }], nextCursor: 'first' });
  api.saveWorkspacePageAccess.mockRejectedValue(Object.assign(new Error('Conflict'), {
    status: 409, data: { error: 'Conflict', message: 'Page access changed' },
  }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><WorkspacePageAccess pageId="page" /></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText('Audience'), { target: { value: 'RESTRICTED' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Load more teammates' }));
  await screen.findByRole('option', { name: 'Bianca' });
  fireEvent.change(screen.getByLabelText('Teammate'), { target: { value: 'later' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add reader' }));
  current = { ...current, revision: 5 };
  await cache.invalidateQueries({ queryKey: ['workspacePageAccess', 'page'] });
  fireEvent.click(screen.getByRole('button', { name: 'Save page access' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Page access changed');
  expect(api.saveWorkspacePageAccess).toHaveBeenCalledWith('page', { revision: 4, mode: 'RESTRICTED', members: [{ userId: 'later', role: 'READ' }] });
  api.getWorkspacePageAccess.mockRejectedValueOnce(new Error('Offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Reload access and discard draft' }));
  await screen.findByText('Access could not be reloaded. Your draft is retained.');
  expect(screen.getByLabelText('Permission for Bianca')).toHaveValue('READ');
  fireEvent.click(screen.getByRole('button', { name: 'Reload access and discard draft' }));
  await waitFor(() => expect(screen.getByLabelText('Audience')).toHaveValue('TEAM'));
});
