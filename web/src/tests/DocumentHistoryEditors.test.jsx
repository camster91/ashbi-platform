import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Notes from '../components/Notes';
import WorkspaceWikiPage from '../pages/WorkspaceWikiPage';
import { api } from '../lib/api';

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'ADMIN' } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../lib/api', () => ({ api: {
  getNotes: vi.fn(), updateNote: vi.fn(), pinNote: vi.fn(),
  getWorkspacePage: vi.fn(), getWorkspacePages: vi.fn(), updateWorkspacePage: vi.fn(),
  listDocumentHistory: vi.fn(), getDocumentRevision: vi.fn(), restoreDocumentRevision: vi.fn(),
} }));

const note = { id: 'note', title: 'Brief', type: 'DOC', content: 'Saved brief', revision: 4, tags: [], updatedAt: '2026-10-15T00:00:00Z' };
const page = { id: 'page', title: 'Handbook', content: 'Saved handbook', revision: 4, parentId: null, permissions: { canEdit: true, canManage: false } };
function mount(editor) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={['/wiki/page']}><Routes><Route path="/wiki/:pageId" element={editor} /></Routes></MemoryRouter></QueryClientProvider>);
  return cache;
}
async function openHistory() {
  fireEvent.click(screen.getByRole('button', { name: 'Version history', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Version history' });
  // A cold lazy import can expose the dialog before its passive keyboard/focus
  // effect has run. Wait for keyboard readiness before sending Escape.
  await waitFor(() => expect(dialog).toContainElement(document.activeElement));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  return dialog;
}
async function confirmOlder() {
  fireEvent.click(await screen.findByRole('button', { name: 'Version 2: Original brief' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Restore this version' }));
  const confirm = screen.getByRole('dialog', { name: 'Restore version 2?' });
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm restore' }));
}

describe('document history in real editors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.getNotes.mockResolvedValue([note]);
    api.getWorkspacePage.mockResolvedValue(page);
    api.getWorkspacePages.mockResolvedValue({ items: [], nextCursor: null });
    api.listDocumentHistory.mockResolvedValue({ items: [{ revision: 4, title: 'Current', isCurrent: true }, { revision: 2, title: 'Original brief' }], currentRevision: 4 });
    api.getDocumentRevision.mockResolvedValue({ revision: 2, title: 'Original brief', content: 'Original content' });
  });

  it('returns to unsaved note fields after history closes without stacking dialogs', async () => {
    mount(<Notes projectId="project" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open note Brief' }));
    fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Unsaved title' } });
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Unsaved content' } });
    fireEvent.change(screen.getByLabelText('Document type'), { target: { value: 'MEETING_NOTES' } });
    await openHistory();
    expect(screen.queryByRole('dialog', { name: 'Edit Note' })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('dialog', { name: 'Edit Note' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByLabelText('Document title')).toHaveValue('Unsaved title');
    expect(screen.getByLabelText('Document content')).toHaveValue('Unsaved content');
    expect(screen.getByLabelText('Document type')).toHaveValue('MEETING_NOTES');
    expect(api.updateNote).not.toHaveBeenCalled();
    expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
  });

  it.each([409, 403])('retains the note draft after a rejected %s restore', async status => {
    api.restoreDocumentRevision.mockRejectedValue({ status });
    mount(<Notes projectId="project" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open note Brief' }));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Do not lose this draft' } });
    await openHistory();
    await confirmOlder();
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 409 ? 'Your editor draft is preserved' : 'no longer have access');
    expect(api.restoreDocumentRevision).toHaveBeenCalledExactlyOnceWith('note', 'note', 2, { revision: 4 });
    if (status === 409) fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await screen.findByRole('dialog', { name: 'Version history' });
    fireEvent.keyDown(document, { key: 'Escape' });
    await screen.findByRole('dialog', { name: 'Edit Note' });
    expect(screen.getByLabelText('Document content')).toHaveValue('Do not lose this draft');
    expect(api.updateNote).not.toHaveBeenCalled();
  });

  it('preserves wiki editing on close and explicitly restores using the editor revision before refreshing', async () => {
    mount(<WorkspaceWikiPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit page' }));
    fireEvent.change(screen.getByLabelText('Page content'), { target: { value: 'Unsaved handbook' } });
    await openHistory();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Page content')).toHaveValue('Unsaved handbook');
    api.restoreDocumentRevision.mockImplementation(async () => {
      api.getWorkspacePage.mockResolvedValue({ ...page, revision: 5, content: 'Original content' });
      return { documentId: 'page', revision: 5, sourceRevision: 2 };
    });
    await openHistory();
    await confirmOlder();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.restoreDocumentRevision).toHaveBeenCalledExactlyOnceWith('page', 'page', 2, { revision: 4 });
    expect(screen.queryByLabelText('Page content')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('region', { name: 'Knowledge page content' })).toHaveTextContent('Original content'));
    expect(api.updateWorkspacePage).not.toHaveBeenCalled();
  });
});
