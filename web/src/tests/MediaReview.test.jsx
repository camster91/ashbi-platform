import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MediaReview, { describeAnchor, formatTimecode } from '../components/review/MediaReview';

vi.mock('../lib/api', () => ({
  api: {
    getPortalReview: vi.fn(),
    portalReviewFileUrl: (token) => `/api/portal/review/${token}/file`,
    addPortalReviewAnnotation: vi.fn(),
    recordPortalReviewDecision: vi.fn(),
    getReviewSession: vi.fn(),
    attachmentFileUrl: (filename) => `/api/attachments/uploads/${filename}`,
    addReviewAnnotation: vi.fn(),
    resolveReviewAnnotation: vi.fn(),
    recordReviewDecision: vi.fn(),
    createReviewShareLink: vi.fn(),
    revokeReviewShareLink: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: PortalReview } = await import('../pages/PortalReview');
const { default: ReviewSession } = await import('../pages/ReviewSession');

const NOW = '2026-09-20T10:00:00.000Z';
const imageAnnotations = [
  { id: 'a1', parentId: null, authorType: 'staff', authorName: 'Terry Team', body: 'Logo feels small', timecodeMs: null, region: { x: 0.4, y: 0.25, w: 0, h: 0 }, pageNumber: null, resolved: false, createdAt: NOW },
  { id: 'a2', parentId: 'a1', authorType: 'guest', authorName: 'Casey Client', body: 'Agreed', timecodeMs: null, region: null, pageNumber: null, resolved: false, createdAt: NOW },
  { id: 'a3', parentId: null, authorType: 'guest', authorName: 'Casey Client', body: 'Love the colours', timecodeMs: null, region: null, pageNumber: null, resolved: true, createdAt: NOW },
];

function renderReview(props = {}) {
  const onAddAnnotation = vi.fn(async (data) => ({ id: 'new-1', ...data }));
  const utils = render(
    <MediaReview
      media={{ kind: 'image', fileName: 'Homepage.png', url: '/file.png' }}
      status="open"
      annotations={imageAnnotations}
      decisions={[]}
      canComment
      canResolve
      onAddAnnotation={onAddAnnotation}
      onResolve={vi.fn(async () => {})}
      onDecide={vi.fn(async () => {})}
      {...props}
    />,
  );
  return { ...utils, onAddAnnotation };
}

function withProviders(path, route, element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={element} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('media review anchors', () => {
  it('describes every anchor in words for the list view', () => {
    expect(formatTimecode(65_432)).toBe('1:05');
    expect(formatTimecode(3_723_000)).toBe('1:02:03');
    expect(describeAnchor({ timecodeMs: 5000 })).toBe('at 0:05');
    expect(describeAnchor({ pageNumber: 3 })).toBe('page 3');
    expect(describeAnchor({ region: { x: 0.4, y: 0.25, w: 0, h: 0 } })).toBe('pinned at 40% across, 25% down');
    expect(describeAnchor({})).toBe('general comment');
  });
});

describe('MediaReview', () => {
  afterEach(() => vi.clearAllMocks());

  it('offers a labelled pin for each pinned comment and a list equivalent', async () => {
    const user = userEvent.setup();
    renderReview();
    const pin = screen.getByRole('button', { name: 'Comment 1 by Terry Team, pinned at 40% across, 25% down' });
    const list = screen.getByRole('list', { name: 'Comment list' });
    expect(within(list).getByText('Logo feels small')).toBeInTheDocument();
    expect(within(list).getByText('general comment')).toBeInTheDocument();
    expect(within(list).getByRole('list', { name: 'Replies to comment 1' })).toHaveTextContent('Agreed');

    pin.focus();
    await user.keyboard('{Enter}');
    expect(pin).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('aria-labelledby', 'annotation-a1-heading'));
  });

  it('pins a new comment to a point with the keyboard-operable position fields', async () => {
    const user = userEvent.setup();
    const { onAddAnnotation } = renderReview();
    await user.click(screen.getByRole('checkbox', { name: 'Pin this comment to a point on the image' }));
    const across = screen.getByRole('spinbutton', { name: 'Across (% from left)' });
    await user.clear(across);
    await user.type(across, '20');
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Move the button');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'Move the button', region: { x: 0.2, y: 0.5, w: 0, h: 0 } });
    expect(await screen.findByText('Comment added.')).toBeInTheDocument();
  });

  it('validates an empty comment and moves focus to it', async () => {
    const user = userEvent.setup();
    const { onAddAnnotation } = renderReview();
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a comment first.');
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveFocus();
    expect(onAddAnnotation).not.toHaveBeenCalled();
  });

  it('pins video comments to the playback time and seeks from the list', async () => {
    const user = userEvent.setup();
    const { container, onAddAnnotation } = renderReview({
      media: { kind: 'video', fileName: 'Walkthrough.webm', url: '/file.webm' },
      annotations: [{ id: 'v1', parentId: null, authorType: 'guest', authorName: 'Casey', body: 'Flicker here', timecodeMs: 5000, region: null, pageNumber: null, resolved: false, createdAt: NOW }],
    });
    const video = container.querySelector('video');
    video.currentTime = 12.5;
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Cut this');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(onAddAnnotation).toHaveBeenCalledWith({ body: 'Cut this', timecodeMs: 12500 });

    await user.click(screen.getByRole('button', { name: 'Play from 0:05 for comment 1' }));
    expect(video.currentTime).toBe(5);
    expect(screen.getByText('Playback moved to 0:05.')).toBeInTheDocument();
  });

  it('resolves and reopens comments for staff', async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn(async () => {});
    renderReview({ onResolve });
    await user.click(screen.getByRole('button', { name: 'Resolve comment 1' }));
    expect(onResolve).toHaveBeenCalledWith('a1', true);
    await user.click(screen.getByRole('button', { name: 'Reopen comment 2' }));
    expect(onResolve).toHaveBeenCalledWith('a3', false);
  });

  it('has no automatically detectable accessibility violations', async () => {
    const { container } = renderReview({ canDecide: true, decisions: [{ id: 'd1', decision: 'changes_requested', actorType: 'guest', actorName: 'Casey', note: 'Swap hero', createdAt: NOW }] });
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('client review page', () => {
  afterEach(() => vi.clearAllMocks());

  const portalData = {
    session: { title: 'Homepage v1', status: 'open', version: 1, media: { fileName: 'Homepage.png', mimeType: 'image/png', size: 10, kind: 'image' } },
    link: { expiresAt: '2026-10-04T10:00:00.000Z', allowDecision: true, canComment: true },
    annotations: imageAnnotations,
    decisions: [],
  };

  it('asks a guest for a name before commenting or deciding, then sends it', async () => {
    const user = userEvent.setup();
    api.getPortalReview.mockResolvedValue(portalData);
    api.addPortalReviewAnnotation.mockResolvedValue({ annotation: { id: 'new-1' } });
    api.recordPortalReviewDecision.mockResolvedValue({ status: 'approved' });
    withProviders('/portal/review/tok', '/portal/review/:token', <PortalReview />);

    await screen.findByRole('heading', { name: 'Homepage v1', level: 1 });
    expect(screen.getByRole('img', { name: 'Reviewed image: Homepage.png' })).toHaveAttribute('src', '/api/portal/review/tok/file');

    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name before commenting.');
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveFocus();
    expect(api.addPortalReviewAnnotation).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Casey Client');
    await user.type(screen.getByRole('textbox', { name: 'Email (optional)' }), 'casey@example.com');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(api.addPortalReviewAnnotation).toHaveBeenCalledWith('tok', { name: 'Casey Client', email: 'casey@example.com', body: 'Hello' }));

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(api.recordPortalReviewDecision).toHaveBeenCalledWith('tok', { name: 'Casey Client', email: 'casey@example.com', decision: 'approved' }));
  });

  it('hides decisions when the link does not allow them, and resolve controls always', async () => {
    api.getPortalReview.mockResolvedValue({ ...portalData, link: { ...portalData.link, allowDecision: false } });
    withProviders('/portal/review/tok', '/portal/review/:token', <PortalReview />);
    await screen.findByRole('heading', { name: 'Homepage v1', level: 1 });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
  });

  it('explains an expired or revoked link', async () => {
    api.getPortalReview.mockRejectedValue(Object.assign(new Error('This review link has expired'), { status: 410 }));
    withProviders('/portal/review/tok', '/portal/review/:token', <PortalReview />);
    expect(await screen.findByRole('heading', { name: 'This review link is no longer active' })).toBeInTheDocument();
    expect(screen.getByText(/This review link has expired/)).toBeInTheDocument();
  });
});

describe('staff review page', () => {
  afterEach(() => vi.clearAllMocks());

  const staffData = {
    session: { id: 'rs-1', projectId: 'project-a', title: 'Homepage v1', status: 'open', version: 1, previousSessionId: null, nextSessionId: null, media: { fileName: 'Homepage.png', filename: 'uuid.png', mimeType: 'image/png', size: 10, kind: 'image' } },
    annotations: imageAnnotations,
    decisions: [],
    shareLinks: [{ id: 'link-1', label: 'Client', allowDecision: true, expiresAt: '2026-10-04T10:00:00.000Z', revokedAt: null, lastUsedAt: null, createdAt: NOW, state: 'active' }],
  };

  it('creates a share link, shows it once, and revokes through a confirmation', async () => {
    const user = userEvent.setup();
    api.getReviewSession.mockResolvedValue(staffData);
    api.createReviewShareLink.mockResolvedValue({ shareLink: { ...staffData.shareLinks[0], id: 'link-2' }, token: 't'.repeat(43), path: `/portal/review/${'t'.repeat(43)}` });
    api.revokeReviewShareLink.mockResolvedValue({ shareLink: { ...staffData.shareLinks[0], state: 'revoked' } });
    withProviders('/review/rs-1', '/review/:id', <ReviewSession />);

    await screen.findByRole('heading', { name: 'Homepage v1', level: 1 });
    expect(screen.getByRole('img', { name: 'Reviewed image: Homepage.png' })).toHaveAttribute('src', '/api/attachments/uploads/uuid.png');

    const days = screen.getByRole('spinbutton', { name: 'Expires after (days)' });
    await user.clear(days);
    await user.type(days, '120');
    await user.click(screen.getByRole('button', { name: 'Create share link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an expiry from 1 to 90 days.');
    expect(days).toHaveFocus();

    await user.clear(days);
    await user.type(days, '30');
    await user.click(screen.getByRole('checkbox', { name: 'Allow the client to approve or request changes' }));
    await user.click(screen.getByRole('button', { name: 'Create share link' }));
    await waitFor(() => expect(api.createReviewShareLink).toHaveBeenCalledWith('rs-1', { expiresInDays: 30, allowDecision: true }));
    const created = await screen.findByRole('textbox', { name: 'New share link (shown only once)' });
    expect(created.value).toBe(`${window.location.origin}/portal/review/${'t'.repeat(43)}`);
    await waitFor(() => expect(created).toHaveFocus());

    await user.click(screen.getByRole('button', { name: 'Revoke Client' }));
    const dialog = await screen.findByRole('dialog', { name: 'Revoke share link?' });
    await user.click(within(dialog).getByRole('button', { name: 'Revoke link' }));
    await waitFor(() => expect(api.revokeReviewShareLink).toHaveBeenCalledWith('rs-1', 'link-1'));
  });

  it('makes a closed session read-only', async () => {
    api.getReviewSession.mockResolvedValue({ ...staffData, session: { ...staffData.session, status: 'closed', nextSessionId: 'rs-2' } });
    withProviders('/review/rs-1', '/review/:id', <ReviewSession />);
    await screen.findByRole('heading', { name: 'Homepage v1', level: 1 });
    expect(screen.getByText('This review is closed. Comments are read-only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create share link' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Newer version' })).toHaveAttribute('href', '/review/rs-2');
  });
});
