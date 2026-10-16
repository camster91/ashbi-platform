import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: {
  getAttachments: vi.fn(), deleteAttachment: vi.fn(), attachmentFileUrl: vi.fn(name => `/api/attachments/uploads/${name}`),
  getReviewSessions: vi.fn(async () => ({ sessions: [] })), getReviewCapabilities: vi.fn(async () => ({})),
  createReviewSession: vi.fn(), uploadAttachment: vi.fn(),
} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner', role: 'TEAM' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('../lib/media-recorder', async (original) => ({ ...(await original()), canRecord: () => true, startCappedRecording: vi.fn() }));
const { api } = await import('../lib/api');
const { startCappedRecording } = await import('../lib/media-recorder');
const { ToastProvider } = await import('../hooks/useToast');
const { default: ProjectFiles } = await import('../components/project/ProjectFiles');
const { default: ProjectReviews } = await import('../components/project/ProjectReviews');
const { default: ProjectMedia } = await import('../components/project/ProjectMedia');

const video = { id: 'video-id', filename: 'video.webm', originalName: 'Screen recording.webm', mimeType: 'video/webm',
  size: 20, createdAt: '2026-10-16T12:00:00Z', uploadedBy: { id: 'owner', name: 'Sam' } };
const pdf = { ...video, id: 'pdf-id', filename: 'brief.pdf', originalName: 'Brief.pdf', mimeType: 'application/pdf' };
function renderPanels() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><ToastProvider>
    <ProjectFiles projectId="p1" /><ProjectReviews projectId="p1" /><ProjectMedia projectId="p1" />
  </ToastProvider></MemoryRouter></QueryClientProvider>);
  return client;
}
const files = () => within(screen.getByRole('region', { name: 'Project files' }));
const reviews = () => within(screen.getByRole('region', { name: 'Media review' }));
const media = () => within(screen.getByRole('region', { name: 'Project media collaboration' }));
async function prepareReview() {
  await reviews().findByRole('option', { name: video.originalName });
  await userEvent.selectOptions(reviews().getByRole('combobox', { name: 'File' }), video.id);
  await userEvent.type(reviews().getByRole('textbox', { name: 'Title' }), 'Screen review');
}
async function confirmDelete() {
  await userEvent.click(await files().findByRole('button', { name: `Delete ${video.originalName}` }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete file' }));
}

describe('shared project attachment data', () => {
  afterEach(() => { vi.clearAllMocks(); delete navigator.mediaDevices; });

  it('refreshes Files, review options and recording Watch together after video deletion without reload', async () => {
    let rows = [video, pdf]; api.getAttachments.mockImplementation(async () => rows);
    api.deleteAttachment.mockImplementation(async () => { rows = [pdf]; return { success: true }; });
    renderPanels(); await prepareReview();
    expect(media().getByRole('link', { name: 'Watch' })).toHaveAttribute('href', '/api/attachments/uploads/video.webm');
    await confirmDelete();
    await waitFor(() => expect(files().queryByText(video.originalName)).not.toBeInTheDocument());
    expect(reviews().queryByRole('option', { name: video.originalName })).not.toBeInTheDocument();
    expect(media().queryByRole('link', { name: 'Watch' })).not.toBeInTheDocument();
    expect(reviews().getByRole('combobox', { name: 'File' })).toHaveValue('');
    expect(reviews().getByRole('textbox', { name: 'Title' })).toHaveValue('Screen review');
    await userEvent.click(reviews().getByRole('button', { name: 'Start review' }));
    expect(api.createReviewSession).not.toHaveBeenCalled();
    expect(reviews().getByRole('alert')).toHaveTextContent('Choose a file to review.');
    expect(api.deleteAttachment).toHaveBeenCalledExactlyOnceWith(video.id);
  });

  it('retains all three views and the selected review file after a refused deletion', async () => {
    api.getAttachments.mockResolvedValue([video, pdf]);
    api.deleteAttachment.mockRejectedValue(Object.assign(new Error('File is under review'), { status: 409 }));
    renderPanels(); await prepareReview(); await confirmDelete();
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('File is under review');
    expect(files().getByText(video.originalName)).toBeInTheDocument();
    expect(reviews().getByRole('option', { name: video.originalName })).toBeInTheDocument();
    expect(reviews().getByRole('combobox', { name: 'File' })).toHaveValue(video.id);
    expect(media().getByRole('link', { name: 'Watch' })).toBeInTheDocument();
  });

  it('checks the latest shared cache before starting a review even before the selection rerenders', async () => {
    api.getAttachments.mockResolvedValue([video, pdf]);
    const client = renderPanels(); await prepareReview();
    const form = reviews().getByRole('form', { name: 'Start a review' });
    await act(async () => {
      client.setQueryData(['project-files', 'p1'], [pdf]);
      fireEvent.submit(form);
    });
    expect(api.createReviewSession).not.toHaveBeenCalled();
    expect(await reviews().findByRole('alert')).toHaveTextContent('Choose a file to review.');
  });

  it('refreshes all three views after a screen recording upload', async () => {
    let rows = [pdf], recorderOptions;
    api.getAttachments.mockImplementation(async () => rows);
    api.uploadAttachment.mockImplementation(async () => { rows = [video, pdf]; return video; });
    startCappedRecording.mockImplementation((_stream, options) => { recorderOptions = options; return { stop: vi.fn() }; });
    const track = { stop: vi.fn() }, stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia: vi.fn(async () => stream) } });
    renderPanels(); await files().findByText(pdf.originalName);
    expect(media().queryByRole('link', { name: 'Watch' })).not.toBeInTheDocument();
    await userEvent.click(media().getByRole('button', { name: 'Record a project screen share' }));
    await act(async () => { await recorderOptions.onStop({ blob: new Blob(['clip'], { type: 'video/webm' }), mimeType: 'video/webm' }); });
    expect(api.uploadAttachment).toHaveBeenCalledWith(expect.any(File), 'PROJECT', 'p1');
    expect(await files().findByText(video.originalName)).toBeInTheDocument();
    expect(reviews().getByRole('option', { name: video.originalName })).toBeInTheDocument();
    expect(media().getByRole('link', { name: 'Watch' })).toBeInTheDocument();
  });
});
