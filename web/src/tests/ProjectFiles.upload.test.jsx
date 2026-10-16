import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getAttachments: vi.fn(),
    setAttachmentClientVisibility: vi.fn(),
    setProjectAttachmentsClientVisibility: vi.fn(),
    uploadAttachmentWithProgress: vi.fn(),
    attachmentFileUrl: vi.fn(() => 'https://configured-api.example.invalid/original-download'),
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
  beforeEach(() => { api.attachmentFileUrl.mockReturnValue('https://configured-api.example.invalid/original-download'); });
  afterEach(() => { vi.clearAllMocks(); });

  it('offers an authenticated per-file Download with exact original names and keyboard focus', async () => {
    api.getAttachments.mockResolvedValue([
      {id:'a-pdf',filename:'11111111-1111-4111-8111-111111111111.pdf',originalName:'brief.final.v2.pdf',size:22,createdAt:'2026-10-01T12:00:00Z',uploadedBy:{id:'u-other',name:'Other'},clientVisible:false},
      {id:'a-heic',filename:'22222222-2222-4222-8222-222222222222.heic',originalName:'photo.original.v3.HEIC',size:44,createdAt:'2026-10-01T12:00:00Z',uploadedBy:{id:'u-sam',name:'Sam'},clientVisible:false},
    ]);
    renderPanel();const user=userEvent.setup();
    const pdfLink=await screen.findByRole('link',{name:'Download brief.final.v2.pdf'});
    const heicLink=screen.getByRole('link',{name:'Download photo.original.v3.HEIC'});
    expect(pdfLink).toHaveAttribute('href','https://configured-api.example.invalid/original-download');
    expect(api.attachmentFileUrl).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111.pdf');
    expect(pdfLink).toHaveAttribute('download','brief.final.v2.pdf');
    expect(heicLink).toHaveAttribute('href','https://configured-api.example.invalid/original-download');
    expect(api.attachmentFileUrl).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222.heic');
    expect(heicLink).toHaveAttribute('download','photo.original.v3.HEIC');
    expect(pdfLink).toHaveTextContent('Download');expect(pdfLink.className).toMatch(/min-h-11/);expect(pdfLink.className).toMatch(/focus-visible:ring-2/);
    await user.tab();expect(screen.getByRole('button',{name:'Upload file'})).toHaveFocus();
    await user.tab();expect(screen.getByRole('button',{name:'Share all with client'})).toHaveFocus();
    await user.tab();expect(pdfLink).toHaveFocus();
    await user.tab();expect(heicLink).toHaveFocus();
    expect(screen.getAllByRole('checkbox',{name:'Visible to client'})[0]).toBeDisabled();
    expect(api.uploadAttachmentWithProgress).not.toHaveBeenCalled();
  });

  it('uses the configured API helper URL verbatim and passes the original stored filename for encoding', async () => {
    const filename='../evil?name=#original.psd';
    const configuredUrl='https://configured-api.example.invalid/v1/attachments/uploads/..%2Fevil%3Fname%3D%23original.psd';
    api.attachmentFileUrl.mockReturnValue(configuredUrl);
    api.getAttachments.mockResolvedValue([{id:'a-special',filename,originalName:'design.final.v2.psd',path:'https://foreign.invalid/public.psd',size:22,createdAt:'2026-10-01T12:00:00Z',uploadedBy:{id:'u-sam'},clientVisible:false}]);
    renderPanel();const link=await screen.findByRole('link',{name:'Download design.final.v2.psd'});
    expect(api.attachmentFileUrl).toHaveBeenCalledWith(filename);
    expect(link).toHaveAttribute('href',configuredUrl);
    expect(link.getAttribute('href')).not.toContain('foreign.invalid');
    expect(link).toHaveAttribute('download','design.final.v2.psd');
  });

  it('does not invent a download URL when no stored filename is available', async () => {
    api.getAttachments.mockResolvedValue([{id:'legacy',originalName:'metadata-only.pdf',size:22,createdAt:'2026-10-01T12:00:00Z',uploadedBy:{id:'u-sam'},clientVisible:false}]);
    renderPanel();await screen.findByText('metadata-only.pdf');expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('offers an Upload file control with a 44px target and says new files stay hidden', async () => {
    api.getAttachments.mockResolvedValue([]);
    renderPanel();
    const input = await screen.findByLabelText('Upload file');
    expect(input).toHaveAttribute('type', 'file');
    expect(input.getAttribute('accept')).toContain('.pdf');
    expect(screen.getByRole('button', { name: 'Upload file' }).className).toMatch(/min-h-11/);
    expect(screen.getByText("Clients can't see new files until you share them.")).toBeInTheDocument();
    expect(screen.getByText(/Up to 64 MiB/)).toBeInTheDocument();
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

  it('accepts an untyped HEIC original with the exact safe name in the staff picker', async () => {
    api.getAttachments.mockResolvedValue([]);api.uploadAttachmentWithProgress.mockResolvedValue({id:'heic'});
    renderPanel();const file=new File(['original'],'photo.final.v2.HEIC');
    await userEvent.setup().upload(await screen.findByLabelText('Upload file'),file);
    await waitFor(()=>expect(api.uploadAttachmentWithProgress).toHaveBeenCalled());
    const sent=api.uploadAttachmentWithProgress.mock.calls[0][0];expect(sent.name).toBe(file.name);expect(sent.type).toBe('image/heic');expect(sent.size).toBe(file.size);
  });

  it('refuses a file over the size limit without sending it', async () => {
    api.getAttachments.mockResolvedValue([]);
    renderPanel();
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 65 * 1024 * 1024 });
    const user = userEvent.setup();
    await user.upload(await screen.findByLabelText('Upload file'), big);
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.pdf is larger than the 64 MiB limit.');
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
