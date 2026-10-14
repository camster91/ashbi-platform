import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import TaskCollaborators from '../components/TaskCollaborators';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getTaskCollaborators: vi.fn(), getTeam: vi.fn(async () => [{ id: 'helper', name: 'Bianca QA', role: 'TEAM', isActive: true }]), saveTaskCollaborators: vi.fn() } }));
function setup(canManage = true) {
  api.getTaskCollaborators.mockResolvedValue({ taskId: 't1', ownerId: 'owner', revision: 4, canManage, collaborators: [] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TaskCollaborators taskId="t1" /></QueryClientProvider>);
}
it('saves selected contributors with the captured membership revision', async () => {
  api.saveTaskCollaborators.mockResolvedValue({ taskId: 't1', ownerId: 'owner', revision: 5, canManage: true, collaborators: [{ id: 'helper', name: 'Bianca QA', isActive: true }] });
  setup();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Bianca QA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save collaborators' }));
  await waitFor(() => expect(api.saveTaskCollaborators).toHaveBeenCalledWith('t1', { revision: 4, userIds: ['helper'] }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save collaborators' })).toBeDisabled());
});
it('retains selections on conflict and leaves nonowners with a read-only roster', async () => {
  api.saveTaskCollaborators.mockRejectedValueOnce(new Error('Collaborators changed. Reload before saving.'));
  setup();
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Bianca QA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save collaborators' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Collaborators changed');
  expect(screen.getByRole('checkbox', { name: 'Bianca QA' })).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Reload roster and discard draft' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Bianca QA' })).not.toBeChecked());
  expect(screen.getByRole('button', { name: 'Save collaborators' })).toBeDisabled();
});
it('does not expose membership editing to a read-only viewer', async () => {
  setup(false);
  await screen.findByRole('region', { name: 'Task collaborators' });
  expect(screen.queryByRole('button', { name: 'Save collaborators' })).not.toBeInTheDocument();
});
