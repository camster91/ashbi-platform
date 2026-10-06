import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const api = {
  getPendingResponses: vi.fn(),
  approveResponse: vi.fn(async () => ({})),
  rejectResponse: vi.fn(async () => ({})),
};

vi.mock('../lib/api', () => ({
  api: new Proxy({}, { get: (_target, prop) => api[prop] ?? vi.fn(async () => ({})) }),
}));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));

const { default: ResponseApprovals } = await import('../pages/ResponseApprovals');

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ResponseApprovals />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const pending = {
  id: 'r1',
  threadId: 'thr-1',
  status: 'PENDING_APPROVAL',
  subject: 'Re: Packaging timeline',
  body: 'Hi Olivia,\nThe dieline is coming Friday.',
  createdAt: '2030-01-01T10:00:00.000Z',
  draftedBy: { id: 'u2', name: 'Sam' },
  thread: { subject: 'Packaging timeline', client: { name: 'Northwind Coffee' }, project: { name: 'Spring labels' } },
};

beforeEach(() => vi.clearAllMocks());

describe('client replies to approve', () => {
  it('lists each waiting reply with its text, context and actions', async () => {
    api.getPendingResponses.mockResolvedValue([pending]);
    renderPage();
    const list = await screen.findByRole('list', { name: 'Replies waiting for approval' });
    const item = within(list).getByRole('listitem');
    expect(within(item).getByRole('heading', { name: 'Packaging timeline' })).toBeInTheDocument();
    expect(within(item).getByText('Northwind Coffee · Spring labels')).toBeInTheDocument();
    expect(within(item).getByText(/The dieline is coming Friday/)).toBeInTheDocument();
    expect(within(item).getByRole('link', { name: /Open conversation/ })).toHaveAttribute('href', '/thread/thr-1');
    expect(screen.getByText(/Approving sends nothing/)).toBeInTheDocument();

    fireEvent.click(within(item).getByRole('button', { name: 'Approve reply to Packaging timeline' }));
    await waitFor(() => expect(api.approveResponse).toHaveBeenCalledWith('r1'));
    expect(toast.success).toHaveBeenCalledWith('Reply approved', expect.stringContaining('Nothing was sent'));
  });

  it('shows an empty state when nothing is waiting', async () => {
    api.getPendingResponses.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nothing to approve')).toBeInTheDocument();
  });

  it('offers a retry when the list cannot load', async () => {
    api.getPendingResponses.mockRejectedValue(new Error('Server unavailable'));
    renderPage();
    expect(await screen.findByText('Replies waiting for approval could not be loaded')).toBeInTheDocument();
  });

  it('keeps the reason when returning fails, and says so', async () => {
    api.getPendingResponses.mockResolvedValue([pending]);
    api.rejectResponse.mockRejectedValueOnce(new Error('Response not pending approval'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Return reply to Packaging timeline' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return to the writer' });
    const reason = within(dialog).getByRole('textbox', { name: /What should change/ });
    fireEvent.change(reason, { target: { value: 'Check the date' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return reply' }));
    expect(await within(dialog).findByText(/Response not pending approval/)).toBeInTheDocument();
    expect(reason).toHaveValue('Check the date');
  });
});
