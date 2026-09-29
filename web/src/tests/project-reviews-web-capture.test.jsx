import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getReviewSessions: vi.fn(async () => ({ sessions: [] })),
    getAttachments: vi.fn(async () => []),
    getReviewCapabilities: vi.fn(),
    captureReviewPage: vi.fn(),
    createReviewSession: vi.fn(),
  },
}));

const { api } = await import('../lib/api');
const { default: ProjectReviews } = await import('../components/project/ProjectReviews');

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ProjectReviews projectId="p1" /></MemoryRouter></QueryClientProvider>);
}

describe('web page review form', () => {
  afterEach(() => vi.clearAllMocks());

  it('is hidden while the server has web capture disabled', async () => {
    api.getReviewCapabilities.mockResolvedValue({ webCapture: { enabled: false } });
    renderPanel();
    await waitFor(() => expect(api.getReviewCapabilities).toHaveBeenCalled());
    expect(screen.queryByRole('textbox', { name: 'Page address' })).not.toBeInTheDocument();
  });

  it('validates the address and captures with the chosen screen size', async () => {
    const user = userEvent.setup();
    api.getReviewCapabilities.mockResolvedValue({ webCapture: { enabled: true } });
    api.captureReviewPage.mockResolvedValue({ session: { id: 'rs-9' } });
    renderPanel();
    const address = await screen.findByRole('textbox', { name: 'Page address' });
    await user.type(address, 'ftp://example.com');
    await user.click(screen.getByRole('button', { name: 'Capture and review' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a full web address starting with http:// or https://.');
    expect(address).toHaveFocus();
    expect(api.captureReviewPage).not.toHaveBeenCalled();

    await user.clear(address);
    await user.type(address, 'https://example.com/pricing');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Screen size' }), 'mobile');
    await user.click(screen.getByRole('button', { name: 'Capture and review' }));
    await waitFor(() => expect(api.captureReviewPage).toHaveBeenCalledWith({ projectId: 'p1', url: 'https://example.com/pricing', viewport: 'mobile', title: 'example.com' }));
  });
});
