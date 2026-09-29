import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getChatMessages: vi.fn(),
    sendChatMessage: vi.fn(),
    uploadChatFile: vi.fn(),
    discardChatUpload: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', name: 'Sam Staff', role: 'ADMIN' } }) }));
vi.mock('../hooks/useSocket', () => ({ useSocket: () => ({ socket: null }) }));

const { api } = await import('../lib/api');
const { default: ProjectChat } = await import('../components/ProjectChat');
const { default: MessageAttachments } = await import('../components/media/MessageAttachments');
const { AttachmentToolbar, useCaptureDialog } = await import('../components/media/ComposerAttachments');
const { useAttachmentDraft } = await import('../components/media/useAttachmentDraft');
const { default: CaptureDialog } = await import('../components/media/CaptureDialog');

const png = (name = 'shot.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });

function renderChat() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectChat projectId="project-1" />
    </QueryClientProvider>,
  );
}

function deferred() {
  let resolveFn;
  let rejectFn;
  const promise = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
  api.getChatMessages.mockResolvedValue([]);
  api.sendChatMessage.mockImplementation(async (_projectId, body) => ({ id: 'm-new', authorId: 'u1', createdAt: new Date().toISOString(), ...body, attachments: [] }));
});

afterEach(() => {
  delete navigator.mediaDevices;
  vi.unstubAllGlobals();
});

describe('staff chat composer attachments', () => {
  it('uploads a pasted screenshot first, blocks sending until it is ready, then sends its id with the message', async () => {
    const upload = deferred();
    api.uploadChatFile.mockReturnValue(upload.promise);
    renderChat();
    const input = await screen.findByLabelText('Internal message to your team');
    fireEvent.paste(input, { clipboardData: { files: [png('')] } });

    expect(api.uploadChatFile).toHaveBeenCalledWith('project-1', expect.any(File), expect.objectContaining({ onProgress: expect.any(Function) }));
    const uploaded = api.uploadChatFile.mock.calls[0][1];
    expect(uploaded.name).toMatch(/^pasted-.*\.png$/);
    expect(screen.getByRole('progressbar', { name: /Uploading pasted-/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await act(async () => { upload.resolve({ id: 'att-1' }); });
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    await waitFor(() => expect(api.sendChatMessage).toHaveBeenCalledWith('project-1', { content: '', visibility: 'INTERNAL', attachmentIds: ['att-1'] }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Files to send with this message' })).toBeNull());
  });

  it('keeps text and files for a retry when the send fails', async () => {
    api.uploadChatFile.mockResolvedValue({ id: 'att-2' });
    api.sendChatMessage.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500, data: {} }));
    const { container } = renderChat();
    await screen.findByLabelText('Internal message to your team');
    const fileInput = container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [png('mock.png')] } });
    await screen.findByText('mock.png');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Internal message to your team'), { target: { value: 'See mock' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Message not sent. Try again.')).toBeInTheDocument();
    expect(screen.getByText('mock.png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.sendChatMessage).toHaveBeenLastCalledWith('project-1', { content: 'See mock', visibility: 'INTERNAL', attachmentIds: ['att-2'] }));
  });

  it('discards an uploaded file the author removes before sending', async () => {
    api.uploadChatFile.mockResolvedValue({ id: 'att-3' });
    const { container } = renderChat();
    await screen.findByLabelText('Internal message to your team');
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [png('extra.png')] } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Remove extra.png' }));
    expect(api.discardChatUpload).toHaveBeenCalledWith('project-1', 'att-3');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('refuses unsupported files and more than ten per message without uploading them', async () => {
    api.uploadChatFile.mockResolvedValue({ id: 'x' });
    const { container } = renderChat();
    await screen.findByLabelText('Internal message to your team');
    const fileInput = container.querySelector('input[type="file"]');
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'clip.mov', { type: 'video/quicktime' })] } });
    expect(await screen.findByText(/clip.mov is not a supported file type/)).toBeInTheDocument();
    fireEvent.change(fileInput, { target: { files: Array.from({ length: 11 }, (_, i) => png(`p${i}.png`)) } });
    expect(await screen.findByText(/up to 10 files/)).toBeInTheDocument();
    expect(api.uploadChatFile).toHaveBeenCalledTimes(10);
    expect(screen.getByRole('button', { name: 'Attach a file to this message' })).toBeDisabled();
  });

  it('renders message files inline from the batched message payload', async () => {
    api.getChatMessages.mockResolvedValue([{
      id: 'm1', content: 'Look', authorId: 'u2', author: { name: 'Priya' }, createdAt: '2030-01-01T10:00:00.000Z',
      attachments: [
        { id: 'a1', originalName: 'hero.png', mimeType: 'image/png', size: 10, url: '/api/attachments/uploads/a1.png' },
        { id: 'a2', originalName: 'walkthrough.webm', mimeType: 'video/webm', size: 10, url: '/api/attachments/uploads/a2.webm' },
      ],
    }]);
    renderChat();
    expect(await screen.findByRole('button', { name: 'Open image hero.png' })).toBeInTheDocument();
    expect(screen.getByLabelText('Video: walkthrough.webm').tagName).toBe('VIDEO');
  });
});

describe('inline message attachments', () => {
  const files = [
    { id: 'i1', name: 'screen.png', mimeType: 'image/png', size: 2048, url: '/api/client-portal/chat-attachments/i1' },
    { id: 'v1', name: 'demo.mp4', mimeType: 'video/mp4', size: 4096, url: '/api/client-portal/chat-attachments/v1' },
    { id: 'au', name: 'note.mp3', mimeType: 'audio/mpeg', size: 1024, url: '/api/client-portal/chat-attachments/au' },
    { id: 'f1', name: 'brief.pdf', mimeType: 'application/pdf', size: 1536, url: '/api/client-portal/chat-attachments/f1' },
    { id: 'q1', originalName: 'bad.webm', mimeType: 'video/webm', size: 1, url: '/x', quarantined: true },
  ];

  it('shows images as thumbnails that open a lightbox, media in native players and other files as cards', () => {
    render(<MessageAttachments attachments={files} resolveUrl={(url) => `https://portal.test${url}`} />);
    const thumbnail = screen.getByRole('button', { name: 'Open image screen.png' });
    expect(within(thumbnail).getByRole('img')).toHaveAttribute('src', 'https://portal.test/api/client-portal/chat-attachments/i1');
    expect(screen.getByLabelText('Video: demo.mp4')).toHaveAttribute('controls');
    expect(screen.getByLabelText('Audio: note.mp3').tagName).toBe('AUDIO');
    expect(screen.getByRole('link', { name: 'Download brief.pdf, 1.5 KB' })).toHaveAttribute('href', 'https://portal.test/api/client-portal/chat-attachments/f1');
    expect(screen.getByText('withheld for security review')).toBeInTheDocument();
    expect(screen.queryByLabelText('Video: bad.webm')).toBeNull();

    fireEvent.click(thumbnail);
    const dialog = screen.getByRole('dialog', { name: 'screen.png' });
    expect(within(dialog).getByRole('img', { name: 'screen.png' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing for a message without files', () => {
    const { container } = render(<MessageAttachments attachments={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

function Toolbar() {
  const draft = useAttachmentDraft({ upload: async () => ({ id: 'x' }) });
  const capture = useCaptureDialog(draft);
  return <AttachmentToolbar draft={draft} capture={capture} />;
}

describe('capture tools feature detection', () => {
  it('hides screen options where getDisplayMedia is missing and keeps camera recording', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn() }, configurable: true });
    vi.stubGlobal('MediaRecorder', class {});
    render(<Toolbar />);
    expect(screen.queryByRole('button', { name: 'Take a screenshot to attach' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Record a camera video to attach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach a file to this message' })).toBeInTheDocument();
  });

  it('offers screenshot and screen recording on desktop browsers', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() }, configurable: true });
    vi.stubGlobal('MediaRecorder', class {});
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: 'Take a screenshot to attach' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record your screen or camera to attach' })).toBeInTheDocument();
  });

  it('offers files only when the browser cannot capture at all', () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: 'Attach a file to this message' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /screenshot|Record/ })).toBeNull();
  });
});

class FakeTrack {
  constructor(kind) { this.kind = kind; this.stop = vi.fn(); this.listeners = {}; }
  addEventListener(event, callback) { this.listeners[event] = callback; }
}
class FakeStream {
  constructor(tracks = []) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((track) => track.kind === 'video'); }
  getAudioTracks() { return this.tracks.filter((track) => track.kind === 'audio'); }
}
class FakeRecorder {
  static isTypeSupported(type) { return type === 'video/webm'; }
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; FakeRecorder.last = this; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['frames'], { type: 'video/webm' }) }); this.onstop(); }
}

describe('Loom-style recording dialog', () => {
  it('counts down, pauses and resumes, stops, previews and attaches a WebM file; re-record returns to setup', async () => {
    vi.useFakeTimers();
    try {
      const screenTrack = new FakeTrack('video');
      const systemAudio = new FakeTrack('audio');
      const micTrack = new FakeTrack('audio');
      const mediaDevices = {
        getDisplayMedia: vi.fn(async () => new FakeStream([screenTrack, systemAudio])),
        getUserMedia: vi.fn(async () => new FakeStream([micTrack])),
      };
      Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
      vi.stubGlobal('MediaStream', FakeStream);
      vi.stubGlobal('MediaRecorder', FakeRecorder);
      const onAttach = vi.fn();
      const onClose = vi.fn();
      render(<CaptureDialog mode="record" support={{ screenshot: true, screen: true, camera: true, record: true }} onAttach={onAttach} onClose={onClose} />);

      expect(screen.getByRole('dialog', { name: 'Record a video' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: /Screen \+ camera/ })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /A tab, window/ }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start recording' })); });
      expect(mediaDevices.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: true });
      expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true });
      expect(screen.getByRole('timer')).toHaveTextContent('3');

      await act(async () => { vi.advanceTimersByTime(3000); });
      expect(FakeRecorder.last.state).toBe('recording');
      expect(FakeRecorder.last.options).toMatchObject({ mimeType: 'video/webm', videoBitsPerSecond: 1_200_000 });
      expect(screen.getByRole('progressbar', { name: 'Recording size' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
      expect(FakeRecorder.last.state).toBe('paused');
      expect(screen.getByText('Paused')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
      expect(FakeRecorder.last.state).toBe('recording');

      await act(async () => { vi.advanceTimersByTime(2000); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop recording' })); });
      expect(screenTrack.stop).toHaveBeenCalled();
      expect(micTrack.stop).toHaveBeenCalled();
      expect(screen.getByLabelText('Recording preview')).toHaveAttribute('src', 'blob:preview');

      fireEvent.click(screen.getByRole('button', { name: 'Re-record' }));
      expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument();

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start recording' })); });
      await act(async () => { vi.advanceTimersByTime(3000); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Stop recording' })); });
      fireEvent.click(screen.getByRole('button', { name: 'Attach recording' }));
      expect(onAttach).toHaveBeenCalledTimes(1);
      const attached = onAttach.mock.calls[0][0];
      expect(attached).toBeInstanceOf(File);
      expect(attached.type).toBe('video/webm');
      expect(attached.name).toMatch(/^screen-recording-.*\.webm$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops (instead of discarding) a running recording when the dialog is dismissed with Escape', async () => {
    vi.useFakeTimers();
    try {
      const cameraTrack = new FakeTrack('video');
      Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(async () => new FakeStream([cameraTrack, new FakeTrack('audio')])) }, configurable: true });
      vi.stubGlobal('MediaStream', FakeStream);
      vi.stubGlobal('MediaRecorder', FakeRecorder);
      const onClose = vi.fn();
      render(<CaptureDialog mode="record" support={{ screenshot: false, screen: false, camera: true, record: true }} onAttach={vi.fn()} onClose={onClose} />);
      expect(screen.queryByRole('radio', { name: /Screen/ })).toBeNull();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start recording' })); });
      await act(async () => { vi.advanceTimersByTime(3000); });
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Recording preview')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bundle boundaries', () => {
  it('loads the capture and markup dialog lazily, never from the composer or portal modules statically', () => {
    const read = (file) => readFileSync(resolve(process.cwd(), file), 'utf8');
    const composer = read('src/components/media/ComposerAttachments.jsx');
    expect(composer).toContain("import('./CaptureDialog')");
    expect(composer).toContain('lazy(loadCaptureDialog)');
    for (const file of ['src/components/media/ComposerAttachments.jsx', 'src/components/media/MessageAttachments.jsx', 'src/components/media/useAttachmentDraft.js', 'src/components/ProjectChat.jsx', 'src/pages/client-portal/shared.jsx', 'src/pages/ClientPortal.jsx']) {
      expect(read(file), file).not.toMatch(/from ['"][^'"]*(CaptureDialog|MarkupEditor|capture-streams)['"]/);
    }
  });
});

describe('attachment draft bookkeeping', () => {

  it('after a send, only the sent files leave the tray; one added mid-send stays', async () => {
    let n = 0;
    const upload = vi.fn(async () => ({ id: `att-${(n += 1)}` }));
    const { result } = renderHook(() => useAttachmentDraft({ upload, discard: vi.fn(async () => ({})) }));
    act(() => { result.current.addFiles([png('sent.png')]); });
    await waitFor(() => expect(result.current.readyIds).toEqual(['att-1']));
    const sentIds = result.current.readyIds;
    act(() => { result.current.addFiles([png('added-while-sending.png')]); });
    await waitFor(() => expect(result.current.readyIds).toEqual(['att-1', 'att-2']));
    act(() => { result.current.clear(sentIds); });
    expect(result.current.items.map((item) => item.name)).toEqual(['added-while-sending.png']);
  });

  it('discards a pending upload from the project it was uploaded to, even after a project switch', async () => {
    const discards = [];
    const upload = vi.fn(async () => ({ id: 'att-old' }));
    const { result, rerender } = renderHook(({ projectId }) => useAttachmentDraft({
      upload,
      discard: async (attachmentId) => { discards.push([projectId, attachmentId]); },
    }), { initialProps: { projectId: 'project-old' } });
    act(() => { result.current.addFiles([png()]); });
    await waitFor(() => expect(result.current.readyIds).toEqual(['att-old']));
    rerender({ projectId: 'project-new' });
    act(() => { result.current.reset(); });
    expect(discards).toEqual([['project-old', 'att-old']]);
  });
});
