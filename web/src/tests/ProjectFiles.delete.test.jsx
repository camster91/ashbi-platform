import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: {
  getAttachments: vi.fn(), deleteAttachment: vi.fn(), attachmentFileUrl: vi.fn(),
} }));
const auth = { user: { id: 'owner', role: 'TEAM' } };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
const { api } = await import('../lib/api');
const { ToastProvider } = await import('../hooks/useToast');
const { default: ProjectFiles } = await import('../components/project/ProjectFiles');

const file = { id: 'attachment-123', originalName: 'Brand brief.pdf', uploadedBy: { id: 'owner', name: 'Sam' }, createdAt: '2026-10-01T12:00:00Z' };
const other = { ...file, id: 'attachment-456', originalName: 'Other brief.pdf', uploadedBy: { id: 'other' } };
function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const panel = (projectId) => <QueryClientProvider client={client}><ToastProvider><ProjectFiles projectId={projectId} /></ToastProvider></QueryClientProvider>;
  const view = render(panel('p1'));
  return { client, changeProject: (id) => view.rerender(panel(id)), rerender: () => view.rerender(panel('p1')) };
}
async function openDelete() {
  await userEvent.click(await screen.findByRole('button', { name: 'Delete Brand brief.pdf' }));
  return screen.findByRole('dialog', { name: 'Delete project file' });
}

describe('project file deletion', () => {
  afterEach(() => { vi.resetAllMocks(); auth.user = { id: 'owner', role: 'TEAM' }; });

  it.each([
    ['TEAM', 'owner', 1], ['ADMIN', 'admin', 2], ['TEAM', 'unrelated', 0], ['CLIENT', 'owner', 0],
  ])('shows delete only for eligible %s actor %s', async (role, id, count) => {
    auth.user = { id, role };
    api.getAttachments.mockResolvedValue([file, other]);
    renderPanel();
    await screen.findByText(file.originalName);
    expect(screen.queryAllByRole('button', { name: /^Delete / })).toHaveLength(count);
  });

  it('names the file and cancellation makes no request', async () => {
    api.getAttachments.mockResolvedValue([file]);
    renderPanel();
    const dialog = await openDelete();
    expect(dialog).toHaveAccessibleDescription('Delete “Brand brief.pdf” from this project? This cannot be undone.');
    expect(api.deleteAttachment).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteAttachment).not.toHaveBeenCalled();
    expect(screen.getByText(file.originalName)).toBeInTheDocument();
  });

  it('sends the persisted ID once, guards pending confirmation, and removes only after refresh', async () => {
    let finishDelete;
    let finishRefresh;
    api.getAttachments.mockResolvedValueOnce([file, other]).mockImplementation(() => new Promise((resolve) => { finishRefresh = resolve; }));
    api.deleteAttachment.mockImplementation(() => new Promise((resolve) => { finishDelete = resolve; }));
    renderPanel();
    const dialog = await openDelete();
    const confirm = within(dialog).getByRole('button', { name: 'Delete file' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(api.deleteAttachment).toHaveBeenCalledExactlyOnceWith('attachment-123');
    expect(confirm).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByText(file.originalName)).toBeInTheDocument();
    await act(async () => { finishDelete({ success: true }); });
    expect(screen.getByText(file.originalName)).toBeInTheDocument();
    await act(async () => { finishRefresh([other]); });
    await waitFor(() => expect(screen.queryByText(file.originalName)).not.toBeInTheDocument());
    expect(screen.getByText(other.originalName)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    [409, 'This attachment is under review and cannot be deleted'],
    [403, 'Cannot delete this attachment'],
    [undefined, 'Failed to fetch'],
  ])('retains the file and selected confirmation after a %s failure', async (status, message) => {
    api.getAttachments.mockResolvedValue([file]);
    api.deleteAttachment.mockRejectedValue(Object.assign(new Error(message), { status }));
    renderPanel();
    const dialog = await openDelete();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message);
    expect(dialog).toHaveAccessibleDescription(/Brand brief.pdf/);
    expect(screen.getByText(file.originalName)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Delete file' })).toBeEnabled();
    expect(api.getAttachments).toHaveBeenCalledTimes(1);
  });

  it('resets the selected file when the project changes, including switching back', async () => {
    api.getAttachments.mockImplementation((_type, projectId) => Promise.resolve(projectId === 'p1' ? [file] : [other]));
    const view = renderPanel();
    const dialog = await openDelete();
    const staleConfirm = within(dialog).getByRole('button', { name: 'Delete file' });
    view.changeProject('p2');
    await screen.findByText(other.originalName);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(staleConfirm);
    view.changeProject('p1');
    await screen.findByText(file.originalName);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'unrelated', role: 'TEAM' },
    { id: 'admin', role: 'ADMIN' },
    { id: 'owner', role: 'ADMIN' },
  ])('invalidates confirmation when the actor changes to $id / $role', async (actor) => {
    api.getAttachments.mockResolvedValue([file]);
    const view = renderPanel();
    const dialog = await openDelete();
    const oldConfirm = within(dialog).getByRole('button', { name: 'Delete file' });
    auth.user = actor;
    view.rerender();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(oldConfirm);
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it('rechecks the current list when the selected file is no longer present', async () => {
    api.getAttachments.mockResolvedValue([file]);
    const view = renderPanel();
    await openDelete();
    await act(async () => { view.client.setQueryData(['project-files', 'p1'], [other]); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it.each([
    { originalName: 'Renamed.pdf' },
    { filename: 'replacement.pdf' },
    { uploadedBy: { id: 'different-uploader' } },
    { entityId: 'different-project' },
    { entityType: 'TASK' },
  ])('invalidates confirmation when the same ID has changed destructive context: %j', async (change) => {
    auth.user = { id: 'admin', role: 'ADMIN' };
    api.getAttachments.mockResolvedValue([file]);
    const view = renderPanel();
    const dialog = await openDelete();
    const oldConfirm = within(dialog).getByRole('button', { name: 'Delete file' });
    await act(async () => { view.client.setQueryData(['project-files', 'p1'], [{ ...file, ...change }]); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(oldConfirm);
    expect(api.deleteAttachment).not.toHaveBeenCalled();
  });

  it('retains confirmation through unrelated visibility and timestamp updates', async () => {
    api.getAttachments.mockResolvedValue([file]);
    api.deleteAttachment.mockResolvedValue({ success: true });
    const view = renderPanel();
    await openDelete();
    await act(async () => { view.client.setQueryData(['project-files', 'p1'], [{ ...file, clientVisible: true, updatedAt: '2026-10-16T12:00:00Z' }]); });
    const dialog = screen.getByRole('dialog', { name: 'Delete project file' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete file' }));
    expect(api.deleteAttachment).toHaveBeenCalledExactlyOnceWith(file.id);
  });
});
