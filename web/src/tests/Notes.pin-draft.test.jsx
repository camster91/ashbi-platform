import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import Notes from '../components/Notes';
import { api } from '../lib/api';

vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../lib/api', () => ({ api: { getNotes: vi.fn(), pinNote: vi.fn(), updateNote: vi.fn() } }));

it('keeps pinning outside the editor and saves against the revision observed after pinning', async () => {
  let note = { id: 'note', title: 'Guide', type: 'DOC', content: 'Original', revision: 0, tags: [], isPinned: false, updatedAt: '2026-10-14T00:00:00Z' };
  api.getNotes.mockImplementation(async () => [structuredClone(note)]);
  api.pinNote.mockImplementation(async () => { note = { ...note, isPinned: true, revision: 1 }; return note; });
  api.updateNote.mockResolvedValue({ ...note, revision: 2 });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Notes projectId="project" /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open note Guide' }));
  fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Pending draft' } });
  expect(screen.getByRole('button', { name: 'Pin Guide', hidden: true })).toBeDisabled();
  expect(api.pinNote).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Pin Guide' }));
  await screen.findByRole('button', { name: 'Unpin Guide' });
  fireEvent.click(screen.getByRole('button', { name: 'Open note Guide' }));
  fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Reviewed draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(api.updateNote).toHaveBeenCalledWith('note', expect.objectContaining({ content: 'Reviewed draft', revision: 1 })));
});
