import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAttachments: vi.fn(),
    setAttachmentClientVisibility: vi.fn(),
    setProjectAttachmentsClientVisibility: vi.fn(),
  },
}));

const auth = { user: { id: 'u-sam', role: 'TEAM' } };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { api } = await import('../lib/api');
const { ToastProvider } = await import('../hooks/useToast');
const { default: ProjectFiles } = await import('../components/project/ProjectFiles');

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><ProjectFiles projectId="p1" /></ToastProvider></QueryClientProvider>);
}

const file = (id, overrides = {}) => ({
  id, originalName: `${id}.pdf`, mimeType: 'application/pdf', size: 1024, createdAt: '2026-09-30T12:00:00.000Z',
  uploadedBy: { id: 'u-sam', name: 'Sam' }, clientVisible: false, ...overrides,
});
const casey = { id: 'u-casey', name: 'Casey' };

describe('project files bulk share', () => {
  afterEach(() => { vi.clearAllMocks(); auth.user = { id: 'u-sam', role: 'TEAM' }; });

  it('offers "Share all with client" while any file is hidden, and "Hide all from client" once all are shared', async () => {
    api.getAttachments.mockResolvedValue([file('a'), file('b', { clientVisible: true })]);
    const { unmount } = renderPanel();
    expect(await screen.findByRole('button', { name: 'Share all with client' })).toBeEnabled();
    expect(screen.getByText('1 of 2 files shared with the client.')).toBeInTheDocument();
    unmount();

    api.getAttachments.mockResolvedValue([file('a', { clientVisible: true }), file('b', { clientVisible: true })]);
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Hide all from client' })).toBeEnabled();
  });

  it('shows no bulk button when the project has no files, while loading, or when the list failed', async () => {
    api.getAttachments.mockResolvedValue([]);
    const { unmount } = renderPanel();
    expect(await screen.findByText('No project files yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all (with|from) client/ })).not.toBeInTheDocument();
    unmount();

    api.getAttachments.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await screen.findByText('Files could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all (with|from) client/ })).not.toBeInTheDocument();
  });

  it('confirms with the count, shares, and undoes with the exact changed ids', async () => {
    const user = userEvent.setup();
    const files = [file('a'), file('b'), file('c', { clientVisible: true }), file('d', { uploadedBy: casey })];
    api.getAttachments.mockResolvedValue(files);
    api.setProjectAttachmentsClientVisibility
      .mockResolvedValueOnce({ changed: 2, changedIds: ['a', 'b'], unchanged: 0, skipped: [{ id: 'd', reason: 'not_permitted' }] })
      .mockResolvedValueOnce({ changed: 2, changedIds: ['a', 'b'], unchanged: 0, skipped: [] });
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Share all with client' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Share 2 files with the client? They’ll see them in their portal’s Documents.');
    expect(dialog).toHaveTextContent('1 file uploaded by someone else will stay hidden: only the uploader or an admin can change it.');
    expect(api.setProjectAttachmentsClientVisibility).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: 'Share 2 files' }));
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenCalledWith('p1', true, ['a', 'b', 'd'], { silent: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The success toast says plainly what was skipped and offers Undo. The
    // confirm step already named the skipped file, so the usual Undo window.
    expect(await screen.findByText('Shared 2 files with the client')).toBeInTheDocument();
    expect(screen.getByText(/1 file was skipped: only the uploader or an admin can share it\./)).toBeInTheDocument();
    expect(screen.getByText(/Undo available for/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenLastCalledWith('p1', false, ['a', 'b'], { silent: true });
    expect(await screen.findByText('Files hidden again')).toBeInTheDocument();
  });

  it('hides all with the inverse confirm wording', async () => {
    const user = userEvent.setup();
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([file('a', { clientVisible: true }), file('b', { clientVisible: true, uploadedBy: casey })]);
    api.setProjectAttachmentsClientVisibility.mockResolvedValue({ changed: 2, changedIds: ['a', 'b'], unchanged: 0, skipped: [] });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Hide all from client' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Hide 2 files from the client? They’ll no longer see them in their portal.');
    await user.click(within(dialog).getByRole('button', { name: 'Hide 2 files' }));
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenCalledWith('p1', false, ['a', 'b'], { silent: true });
    expect(await screen.findByText('Hid 2 files from the client')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('counts review-shared files as shared and never claims hiding removes them', async () => {
    const user = userEvent.setup();
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([
      file('a', { clientVisible: true }),
      file('r', { clientVisible: true, sharedViaReview: true }),
      file('only-review', { sharedViaReview: true }),
    ]);
    api.setProjectAttachmentsClientVisibility.mockResolvedValue({ changed: 2, changedIds: ['a', 'r'], unchanged: 0, skipped: [] });
    renderPanel();
    expect(await screen.findByText('3 of 3 files shared with the client.')).toBeInTheDocument();
    expect(screen.getAllByText('Visible to the client through a shared review.')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Hide all from client' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(/Stop sharing 2 files with the client\? 1 file shared through a client review stays visible\./);
    expect(dialog).not.toHaveTextContent('no longer see');
    await user.click(within(dialog).getByRole('button', { name: 'Stop sharing 2 files' }));
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenCalledWith('p1', false, ['a', 'r'], { silent: true });
    expect(await screen.findByText('Stopped sharing 2 files')).toBeInTheDocument();
    expect(screen.getByText('1 file shared through a client review stays visible.')).toBeInTheDocument();
    expect(screen.queryByText(/from the client$/)).not.toBeInTheDocument();
  });

  it('leaves files the client uploaded out of a bulk hide', async () => {
    const user = userEvent.setup();
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([
      file('a', { clientVisible: true }),
      file('c', { clientVisible: true, uploadedBy: { id: 'u-client', name: 'Client', role: 'CLIENT' } }),
    ]);
    api.setProjectAttachmentsClientVisibility.mockResolvedValue({ changed: 1, changedIds: ['a'], unchanged: 0, skipped: [] });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Hide all from client' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Hide 1 file from the client? They’ll no longer see it in their portal. Files the client uploaded stay visible.');
    await user.click(within(dialog).getByRole('button', { name: 'Hide 1 file' }));
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenCalledWith('p1', false, ['a'], { silent: true });
  });

  it('keeps an unexpected skip on screen until dismissed', async () => {
    const user = userEvent.setup();
    api.getAttachments.mockResolvedValue([file('a'), file('b')]);
    api.setProjectAttachmentsClientVisibility.mockResolvedValue({ changed: 1, changedIds: ['a'], unchanged: 0, skipped: [{ id: 'b', reason: 'not_found' }] });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Share all with client' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Share 2 files' }));
    expect(await screen.findByText(/1 file was skipped because it is no longer in this project\./)).toBeInTheDocument();
    expect(screen.queryByText(/Undo available for/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('shows a second identical bulk result with its own Undo', async () => {
    const user = userEvent.setup();
    auth.user = { id: 'u-admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([file('a')]);
    api.setProjectAttachmentsClientVisibility.mockResolvedValue({ changed: 1, changedIds: ['a'], unchanged: 0, skipped: [] });
    renderPanel();
    for (let round = 0; round < 2; round += 1) {
      await user.click(await screen.findByRole('button', { name: 'Share all with client' }));
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Share 1 file' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(screen.getAllByText('Shared 1 file with the client')).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(2);
  });

  it('keeps the dialog open and announces a failure', async () => {
    const user = userEvent.setup();
    api.getAttachments.mockResolvedValue([file('a')]);
    api.setProjectAttachmentsClientVisibility.mockRejectedValue(new Error('Project not found'));
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Share all with client' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Share 1 file with the client? They’ll see it in their portal’s Documents.');
    await user.click(within(dialog).getByRole('button', { name: 'Share 1 file' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Project not found');
    expect(api.setProjectAttachmentsClientVisibility).toHaveBeenCalledWith('p1', true, ['a'], { silent: true });
    expect(screen.queryByText(/^Shared /)).not.toBeInTheDocument();
  });

  it('disables the button, with the reason, when every hidden file belongs to someone else', async () => {
    api.getAttachments.mockResolvedValue([file('d', { uploadedBy: casey })]);
    renderPanel();
    const button = await screen.findByRole('button', { name: 'Share all with client' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Only the uploader or an admin can share this file.');
  });
});
