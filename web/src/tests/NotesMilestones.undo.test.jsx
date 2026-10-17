import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Notes from '../components/Notes';
import Milestones from '../components/Milestones';
import { ToastProvider } from '../hooks/useToast';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: {
  getNotes: vi.fn(), deleteNote: vi.fn(),
  getMilestones: vi.fn(), deleteMilestone: vi.fn(), restoreTrashItem: vi.fn(),
} }));

const note = { id: 'note-one', title: 'Project guide', type: 'DOC', content: 'Team notes', tags: [], revision: 0, permissions: { canEdit: true, canManage: true } };
const milestone = { id: 'milestone-one', name: 'Client approval', status: 'PENDING', dueDate: '2026-11-01T00:00:00Z', color: 'currentColor', completedTasks: 0, totalTasks: 0, progress: 0 };
const cases = [
  { label: 'note', Component: Notes, record: note, list: 'getNotes', remove: 'deleteNote', opener: 'Open note Project guide', confirm: 'Delete note', name: note.title },
  { label: 'milestone', Component: Milestones, record: milestone, list: 'getMilestones', remove: 'deleteMilestone', opener: /^Open milestone Client approval/, confirm: 'Delete milestone', name: milestone.name },
];
const clients = [];
beforeEach(() => vi.resetAllMocks());
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

async function deleteRecord({ Component, record, list, remove, opener, confirm, name }) {
  let deleted = false;
  api[list].mockImplementation(async () => deleted ? [] : [record]);
  api[remove].mockImplementation(async () => { deleted = true; return { trashId: 'trash-exact-record' }; });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><ToastProvider><Component projectId="project-one" /></ToastProvider></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: opener }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: confirm });
  expect(api[remove]).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: confirm, exact: true }));
  const undo = await screen.findByRole('button', { name: `Undo delete ${name}` });
  return { undo, restoreList: () => { deleted = false; } };
}

describe.each(cases)('$label Undo completion', entry => {
  it('keeps one restore pending and dismisses Undo only after successful restoration', async () => {
    let resolve;
    api.restoreTrashItem.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { undo, restoreList } = await deleteRecord(entry);
    fireEvent.click(undo);
    await waitFor(() => expect(undo).toBeDisabled());
    fireEvent.click(undo);
    expect(api.restoreTrashItem).toHaveBeenCalledTimes(1);
    expect(api.restoreTrashItem.mock.calls[0][0]).toBe('trash-exact-record');
    expect(undo).toBeInTheDocument();
    expect(screen.queryByText(`${entry.label === 'note' ? 'Note' : 'Milestone'} restored`)).not.toBeInTheDocument();
    restoreList();
    await act(async () => resolve({ restored: true }));
    await waitFor(() => expect(undo).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: entry.opener })).toBeInTheDocument();
    expect(screen.getByText(`${entry.label === 'note' ? 'Note' : 'Milestone'} restored`)).toBeInTheDocument();
  });

  it('retains Undo and truthful error feedback after a failed restore, allowing explicit retry', async () => {
    let reject;
    api.restoreTrashItem.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const { undo } = await deleteRecord(entry);
    fireEvent.click(undo);
    await waitFor(() => expect(undo).toBeDisabled());
    await act(async () => reject(new Error('Restore unavailable')));
    await waitFor(() => expect(undo).not.toBeDisabled());
    expect(screen.getByRole('alert')).toHaveTextContent(`Could not restore ${entry.label}`);
    expect(screen.getByRole('alert')).toHaveTextContent('Restore unavailable');
    expect(screen.queryByRole('button', { name: entry.opener })).not.toBeInTheDocument();
    expect(api.restoreTrashItem).toHaveBeenCalledTimes(1);
    api.restoreTrashItem.mockResolvedValueOnce({ restored: true });
    fireEvent.click(undo);
    await waitFor(() => expect(api.restoreTrashItem).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(undo).not.toBeInTheDocument());
  });
});
