import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getReviewSession: vi.fn(),
    getReviewCapabilities: vi.fn(async () => ({ webCapture: { enabled: false } })),
    getTeam: vi.fn(async () => []),
    attachmentFileUrl: (filename) => `/api/attachments/uploads/${filename}`,
    setReviewClientAccess: vi.fn(async () => ({})),
    addReviewAnnotation: vi.fn(),
    resolveReviewAnnotation: vi.fn(),
    recordReviewDecision: vi.fn(),
    createReviewShareLink: vi.fn(),
    revokeReviewShareLink: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: ReviewSession } = await import('../pages/ReviewSession');

const session = { id: 'rs-1', projectId: 'p1', title: 'Homepage', status: 'open', version: 1, previousSessionId: null, nextSessionId: null, sharedWithClient: false, clientCanDecide: false, media: { fileName: 'Home.png', filename: 'u.png', mimeType: 'image/png', size: 1, kind: 'image' } };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/review/rs-1']}><Routes><Route path="/review/:id" element={<ReviewSession />} /></Routes></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('staff review client sharing', () => {
  afterEach(() => vi.clearAllMocks());

  it('is internal by default, and shares with the client on request', async () => {
    const user = userEvent.setup();
    api.getReviewSession.mockResolvedValue({ session, annotations: [], decisions: [], shareLinks: [], versions: [] });
    renderPage();
    await screen.findByRole('heading', { name: 'Homepage', level: 1 });
    expect(screen.getByText('Internal')).toBeInTheDocument();
    expect(screen.queryByText('Visible to client')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Let the client approve or request changes in the client portal' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Share with client' }));
    await waitFor(() => expect(api.setReviewClientAccess).toHaveBeenCalledWith('rs-1', { sharedWithClient: true }));
  });

  it('shows a Visible to client badge and allows decisions once shared', async () => {
    const user = userEvent.setup();
    api.getReviewSession.mockResolvedValue({ session: { ...session, sharedWithClient: true }, annotations: [], decisions: [], shareLinks: [], versions: [] });
    renderPage();
    await screen.findByRole('heading', { name: 'Homepage', level: 1 });
    expect(screen.getByText('Visible to client')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Let the client approve or request changes in the client portal' }));
    await waitFor(() => expect(api.setReviewClientAccess).toHaveBeenCalledWith('rs-1', { clientCanDecide: true }));
  });
});
