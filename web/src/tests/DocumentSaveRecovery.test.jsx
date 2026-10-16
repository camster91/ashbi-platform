import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DocumentSaveRecovery from '../components/DocumentSaveRecovery';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { getNote: vi.fn() } }));

describe('Document save recovery', () => {
  it('retains a rejected draft during an offline reload and only replaces it after a successful fresh read', async () => {
    const onReload = vi.fn();
    api.getNote.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'note', revision: 2, title: 'Saved title', content: 'Team update', permissions: { canEdit: true } });
    render(<DocumentSaveRecovery noteId="note" draft={{ content: 'My draft', revision: 0 }} error={new Error('Document changed')} onReload={onReload} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
    await screen.findByText('The document could not be reloaded. Your draft is still retained.');
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
    await waitFor(() => expect(onReload).toHaveBeenCalledWith({ id: 'note', revision: 2, title: 'Saved title', content: 'Team update', permissions: { canEdit: true } }));
    expect(api.getNote).toHaveBeenCalledWith('note');
  });
  it('compares plaintext without replacing the draft, then explicitly hands only reviewed text and fresh revision to the editor', async () => {
    const current = { id: 'note', revision: 2, title: '<b>Saved</b>', content: '<script>bad()</script>', tags: ['latest'], permissions: { canEdit: true } };
    const draft = { title: 'Local title', content: 'Local draft', tags: ['unsaved'], revision: 0 };
    const onReconcile = vi.fn(), onReload = vi.fn();api.getNote.mockResolvedValue(current);
    const { container } = render(<DocumentSaveRecovery noteId="note" draft={draft} error={new Error('Changed')} onReload={onReload} onReconcile={onReconcile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));
    await screen.findByText('<script>bad()</script>');expect(container.querySelector('script')).toBeNull();expect(onReconcile).not.toHaveBeenCalled();expect(onReload).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reviewed merged content'), { target: { value: 'Both changes' } });
    expect(draft.content).toBe('Local draft');
    fireEvent.click(screen.getByRole('button', { name: 'Use reviewed merge in editor' }));
    expect(onReconcile).toHaveBeenCalledWith({ current, draft: { title: 'Local title', content: 'Both changes' } });expect(onReload).not.toHaveBeenCalled();
  });
  it.each([new Error('Offline'), Object.assign(new Error('Revoked'), { status: 404 })])('hides prior comparison on failed fresh read and keeps download available: %s', async failure => {
    api.getNote.mockResolvedValueOnce({ id: 'note', revision: 1, title: 'Saved', content: 'Private saved content', permissions: { canEdit: true } }).mockRejectedValueOnce(failure);
    render(<DocumentSaveRecovery noteId="note" draft={{ title: 'Mine', content: 'Local' }} error={new Error('Changed')} onReload={vi.fn()} onReconcile={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));await screen.findByText('Private saved content');
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));await screen.findByText(/could not be reloaded/);
    expect(screen.queryByText('Private saved content')).not.toBeInTheDocument();expect(screen.getByRole('button', { name: 'Download draft' })).toBeEnabled();
  });
  it.each([{ id: 'foreign', revision: 1, title: 'Foreign', content: 'Foreign private', permissions: { canEdit: true } }, { id: 'note', revision: 1, title: 'Read only', content: 'Private', permissions: { canEdit: false } }, { id: 'note', revision: null, title: 'Malformed', content: 'Private', permissions: { canEdit: true } }])('refuses unavailable identity/authority/revision before showing remote text', async current => {
    api.getNote.mockResolvedValue(current);const reconcile = vi.fn();
    render(<DocumentSaveRecovery noteId="note" draft={{ title: 'Mine', content: 'Local' }} error={new Error('Changed')} onReload={vi.fn()} onReconcile={reconcile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));await screen.findByText(/could not be reloaded/);
    expect(screen.queryByRole('region', { name: 'Review document merge' })).not.toBeInTheDocument();expect(reconcile).not.toHaveBeenCalled();
  });
  it('ignores a delayed old-document response after identity changes and after unmount', async () => {
    let resolve;api.getNote.mockImplementation(() => new Promise(done => { resolve = done; }));const reconcile = vi.fn(), reload = vi.fn(), error = new Error('Changed');
    const view = render(<DocumentSaveRecovery noteId="old" draft={{ title: 'Old', content: 'Old local' }} error={error} onReload={reload} onReconcile={reconcile} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));
    view.rerender(<DocumentSaveRecovery noteId="new" draft={{ title: 'New', content: 'New local' }} error={error} onReload={reload} onReconcile={reconcile} />);
    await act(async () => resolve({ id: 'old', revision: 8, title: 'Old saved', content: 'Old private', permissions: { canEdit: true } }));
    expect(screen.queryByText('Old private')).not.toBeInTheDocument();expect(reconcile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));view.unmount();
    await act(async () => resolve({ id: 'new', revision: 9, title: 'New saved', content: 'New private', permissions: { canEdit: true } }));expect(reload).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { canEdit: 'false' }, { canEdit: 'true' }, { canEdit: 1 }, { canEdit: false }])('refuses missing/malformed/readonly permissions for comparison AND discard, retaining local download: %j', async permissions => {
    const onReload = vi.fn(), onReconcile = vi.fn();
    api.getNote.mockResolvedValue({ id: 'note', revision: 2, title: 'Private saved title', content: 'Private saved text', permissions });
    render(<DocumentSaveRecovery noteId="note" draft={{ title: 'Local', content: 'Keep my draft' }} error={new Error('Changed')} onReload={onReload} onReconcile={onReconcile} />);
    for (const name of ['Compare latest saved document', 'Reload document and discard draft']) {
      fireEvent.click(screen.getByRole('button', { name }));await screen.findByText(/could not be reloaded/);
      expect(screen.queryByText('Private saved text')).not.toBeInTheDocument();expect(screen.getByRole('button', { name: 'Download draft' })).toBeEnabled();expect(onReload).not.toHaveBeenCalled();expect(onReconcile).not.toHaveBeenCalled();
    }
  });
  it('requires another comparison if local draft changes and disables recovery during an active save', async () => {
    const error = new Error('Changed'), reconcile = vi.fn();api.getNote.mockResolvedValue({ id: 'note', revision: 2, title: 'Saved', content: 'Saved', permissions: { canEdit: true } });
    const props = { noteId: 'note', draft: { title: 'Mine', content: 'Local' }, error, onReload: vi.fn(), onReconcile: reconcile };
    const view = render(<DocumentSaveRecovery {...props} />);fireEvent.click(screen.getByRole('button', { name: 'Compare latest saved document' }));await screen.findByLabelText('Reviewed merged content');
    view.rerender(<DocumentSaveRecovery {...props} draft={{ ...props.draft, content: 'Later local' }} />);
    expect(screen.getByRole('button', { name: 'Use reviewed merge in editor' })).toBeDisabled();
    view.rerender(<DocumentSaveRecovery {...props} busy />);expect(screen.getByRole('button', { name: 'Compare latest saved document' })).toBeDisabled();expect(screen.queryByLabelText('Reviewed merged content')).not.toBeInTheDocument();
  });
});
