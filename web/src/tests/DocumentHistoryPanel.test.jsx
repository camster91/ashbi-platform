import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { listDocumentHistory: vi.fn(), getDocumentRevision: vi.fn(), restoreDocumentRevision: vi.fn() };
const auth = { user: { id: 'staff-1', role: 'TEAM' } };
vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const { default: DocumentHistoryPanel } = await import('../components/DocumentHistoryPanel');
const rows = { items: [{ revision: 4, title: 'Current title', isCurrent: true }, { revision: 2, title: 'Older title', editedById: null }], limit: 100, currentRevision: 4 };

function setup(props = {}, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const onRestored = vi.fn();
  const element = (next = {}) => <QueryClientProvider client={client}><DocumentHistoryPanel kind="note" documentId="doc-1" currentRevision={4} onRestored={onRestored} {...props} {...next} /></QueryClientProvider>;
  const view = render(element());
  return { ...view, client, onRestored, change: (next) => view.rerender(element(next)) };
}
async function openOlder() {
  fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Version 2: Older title' }));
  return screen.findByRole('region', { name: 'Preview of version 2' });
}

describe('DocumentHistoryPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.user = { id: 'staff-1', role: 'TEAM' };
    api.listDocumentHistory.mockResolvedValue(rows);
    api.getDocumentRevision.mockResolvedValue({ revision: 2, title: 'Older title', content: '<img src=x onerror=alert(1)>\n**Original**' });
    api.restoreDocumentRevision.mockResolvedValue({ documentId: 'doc-1', revision: 5, sourceRevision: 2 });
  });

  it('fetches lazily and lets staff read safely without restore actions', async () => {
    const { onRestored } = setup();
    expect(api.listDocumentHistory).not.toHaveBeenCalled();
    expect(api.getDocumentRevision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(await screen.findByRole('button', { name: 'Version 2: Older title' })).toBeInTheDocument();
    expect(api.getDocumentRevision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Version 2: Older title' }));
    const preview = await screen.findByRole('region', { name: 'Preview of version 2' });
    expect(preview).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(preview.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
    expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('requires explicit admin confirmation and sends the current revision CAS', async () => {
    auth.user.role = 'ADMIN';
    const { onRestored, client } = setup();
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
    const confirm = screen.getByRole('dialog', { name: 'Restore version 2?' });
    expect(confirm).toHaveTextContent('Unsaved editor changes may be replaced');
    expect(confirm).toHaveTextContent('Sharing, parent placement and mentions stay unchanged');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Confirm restore' }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ documentId: 'doc-1', revision: 5, sourceRevision: 2 }));
    expect(api.restoreDocumentRevision).toHaveBeenCalledExactlyOnceWith('note', 'doc-1', 2, { revision: 4 });
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['document-history', 'staff-1', 'note', 'doc-1'] });
  });

  it('keeps the caller draft untouched and blocks repeated restore after conflict', async () => {
    auth.user.role = 'ADMIN';
    api.restoreDocumentRevision.mockRejectedValue({ status: 409 });
    const { onRestored } = setup();
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your editor draft is preserved');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(api.restoreDocumentRevision).toHaveBeenCalledTimes(1);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('does not apply a confirmation after the current revision changes', async () => {
    auth.user.role = 'ADMIN';
    const { change } = setup();
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    change({ currentRevision: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(screen.getByRole('alert')).toHaveTextContent('This document changed');
    expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
  });

  it('clears selection when changing documents or signed-in staff', async () => {
    const { change, client } = setup();
    await openOlder();
    change({ documentId: 'doc-2' });
    expect(screen.queryByText('Older title')).not.toBeInTheDocument();
    expect(api.listDocumentHistory).toHaveBeenCalledTimes(1);
    auth.user = { id: 'staff-2', role: 'TEAM' };
    api.listDocumentHistory.mockResolvedValue({ items: [], currentRevision: 1 });
    change({ documentId: 'doc-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(await screen.findByText('No recorded revisions yet.')).toBeInTheDocument();
    expect(client.getQueryData(['document-history', 'staff-2', 'note', 'doc-2'])).toEqual({ items: [], currentRevision: 1 });
    expect(screen.queryByText('Older title')).not.toBeInTheDocument();
  });

  it('hides cached history and detail on a denied refresh and permits retry', async () => {
    setup();
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    api.listDocumentHistory.mockRejectedValue({ status: 403 });
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer have access');
    expect(screen.queryByText('Older title')).not.toBeInTheDocument();
    expect(screen.queryByText('<img src=x onerror=alert(1)>')).not.toBeInTheDocument();
    api.listDocumentHistory.mockResolvedValue({ items: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    expect(await screen.findByText('No recorded revisions yet.')).toBeInTheDocument();
  });

  it('hides the staff feature from client sessions and disables restore without a loaded revision', async () => {
    auth.user.role = 'CLIENT';
    const { change } = setup();
    expect(screen.queryByRole('button', { name: 'Version history' })).not.toBeInTheDocument();
    auth.user.role = 'ADMIN';
    change({ currentRevision: undefined });
    await openOlder();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
    expect(api.restoreDocumentRevision).not.toHaveBeenCalled();
  });

  it('hides the selected revision and cached list if restore loses authorization', async () => {
    auth.user.role = 'ADMIN';
    api.restoreDocumentRevision.mockRejectedValue({ status: 403 });
    const { onRestored } = setup();
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer have access');
    expect(screen.queryByText('Older title')).not.toBeInTheDocument();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('discards a late restore callback after switching documents', async () => {
    auth.user.role = 'ADMIN';
    let finish;
    api.restoreDocumentRevision.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { change, onRestored } = setup();
    await openOlder();
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    change({ documentId: 'doc-2' });
    finish({ documentId: 'doc-1', revision: 5, sourceRevision: 2 });
    await waitFor(() => expect(api.restoreDocumentRevision).toHaveResolved());
    expect(onRestored).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports a controlled history dialog without its own trigger or duplicate close callbacks', async () => {
    const onOpenChange = vi.fn();
    const { change } = setup({ open: true, hideTrigger: true, onOpenChange });
    expect(screen.queryByRole('button', { name: 'Version history' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Version 2: Older title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    // The owner controls dismissal and can reveal its still-mounted editor draft.
    expect(screen.getByRole('dialog', { name: 'Version history' })).toBeInTheDocument();
    change({ open: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
  });
});
