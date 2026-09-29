import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReviewsTab from '../pages/client-portal/ReviewsTab';

const NOW = '2026-09-20T10:00:00.000Z';
const list = { sessions: [{ id: 'rs-1', projectId: 'p1', projectName: 'Website', title: 'Homepage', status: 'open', version: 2, openAnnotationCount: 1, createdAt: NOW, media: { kind: 'image', fileName: 'Home.png' } }] };
const detail = {
  session: { id: 'rs-1', projectId: 'p1', projectName: 'Website', title: 'Homepage', status: 'open', version: 2, capture: { viewport: 'mobile' }, media: { kind: 'image', fileName: 'Home.png', mimeType: 'image/png', size: 10 } },
  versions: [{ id: 'rs-0', version: 1, status: 'closed' }, { id: 'rs-1', version: 2, status: 'open' }],
  permissions: { canComment: true, canDecide: false },
  annotations: [{ id: 'a1', parentId: null, authorType: 'staff', authorName: 'Terry Team', body: 'Team note', timecodeMs: null, region: null, pageNumber: null, resolved: false, createdAt: NOW }],
  decisions: [],
};

function respond(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body });
}

describe('client portal Reviews tab', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((url, options = {}) => {
      if (url.endsWith('/api/client-portal/reviews')) return respond(list);
      if (url.endsWith('/api/client-portal/reviews/rs-1') && !options.method) return respond(detail);
      if (url.endsWith('/api/client-portal/reviews/rs-1/annotations')) return respond({ annotation: { id: 'new' } }, 201);
      return respond({ error: 'Review not found' }, 404);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('lists the client\'s reviews, opens one and comments as the signed-in contact', async () => {
    const user = userEvent.setup();
    render(<ReviewsTab token={null} />);
    await user.click(await screen.findByRole('button', { name: 'Open review Homepage, version 2' }));
    expect(await screen.findByRole('heading', { name: 'Homepage', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Reviewed image: Home.png' })).toHaveAttribute('src', '/api/client-portal/reviews/rs-1/file');
    expect(screen.getByText('Team note')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Version' })).toBeInTheDocument();
    // No guest name fields, no decision buttons unless the team allowed them, no resolve controls.
    expect(screen.queryByRole('textbox', { name: 'Your name' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resolve/ })).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Looks great');
    await user.click(screen.getByRole('button', { name: 'Add comment' }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/client-portal/reviews/rs-1/annotations',
      expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ body: 'Looks great' }) }),
    ));
  });

  it('shows a not-available state for a review the client cannot reach', async () => {
    const user = userEvent.setup();
    globalThis.fetch.mockImplementation((url) => (url.endsWith('/reviews') ? respond(list) : respond({ error: 'Review not found' }, 404)));
    render(<ReviewsTab token={null} />);
    await user.click(await screen.findByRole('button', { name: 'Open review Homepage, version 2' }));
    expect(await screen.findByText('This review is no longer available.')).toBeInTheDocument();
  });
});
