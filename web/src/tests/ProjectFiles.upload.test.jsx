import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAttachments: vi.fn(),
    setAttachmentClientVisibility: vi.fn(),
    setProjectAttachmentsClientVisibility: vi.fn(),
    uploadAttachmentWithProgress: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-sam', role: 'TEAM' } }) }));

const { api } = await import('../lib/api');
const { ToastProvider } = await import('../hooks/useToast');
const { default: ProjectFiles } = await import('../components/project/ProjectFiles');

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ToastProvider><ProjectFiles projectId="p1" /></ToastProvider></QueryClientProvider>);
}

const pdf = () => new File(['%PDF-1.4 brief'], 'brief.pdf', { type: 'application/pdf' });

describe('project files upload', () => {
  afterEach(() => { vi.clearAllMocks(); });

  it('offers an Upload file control with a 44px target and says new files stay hidden', async () => {
    api.getAttachments.mockResolvedValue([]);
    renderPanel();
    const input = await screen.findByLabelText('Upload file');
    expect(input).toHaveAttribute('type', 'file');
    expect(input.getAttribute('accept')).toContain('.pdf');
    expect(screen.getByRole('button', { name: 'Upload file' }).className).toMatch(/min-h-11/);
    expect(screen.getByText("Clients can't see new files until you share them.")).toBeInTheDocument();
    expect(screen.getByText(/Up to 50 MB/)).toBeInTheDocument();
  });

  it('uploads to the project, shows progress, then refreshes the list', async () => {
    const user = userEvent.setup();
    api.getAttachments.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'a-9', originalName: 'brief.pdf', size: 14, createdAt: '2026-10-01T12:00:00.000Z', uploadedBy: { id: 'u-sam', name: 'Sam' }, clientVisible: false },
    ]);
    let finish;
    api.uploadAttachmentWithProgress.mockImplementation((file, entityType, entityId, { onProgress }) => new Promise((resolve) => {
      onProgress(0.4);
      finish = () => resolve({ id: 'a-9' });
    }));
    renderPanel();

    await user.upload(await screen.findByLabelText('Upload file'), pdf());
    expect(api.uploadAttachmentWithProgress).toHaveBeenCalledWith(expect.any(File), 'PROJECT', 'p1', expect.objectContaining({ onProgress: expect.any(Function) }));
    const bar = await screen.findByRole('progressbar', { name: 'Uploading brief.pdf' });
    expect(bar).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByText(/Uploading brief.pdf: 40%/)).toBeInTheDocument();

    finish();
    expect(await screen.findByText('brief.pdf')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Visible to client' })).not.toBeChecked();
  });

  it('refuses a file over the size limit without sending it', async () => {
    api.getAttachments.mockResolvedValue([]);
    renderPanel();
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Upload file'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.pdf is larger than the 50 MB limit.');
    expect(api.uploadAttachmentWithProgress).not.toHaveBeenCalled();
  });

  it('shows the server reason when an upload fails', async () => {
    const user = userEvent.setup();
    api.getAttachments.mockResolvedValue([]);
    api.uploadAttachmentWithProgress.mockRejectedValue(new Error('File content does not match its type'));
    renderPanel();
    await user.upload(await screen.findByLabelText('Upload file'), pdf());
    expect(await screen.findByRole('alert')).toHaveTextContent('brief.pdf was not uploaded: File content does not match its type');
  });
});
