import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMoney } from '../lib/format';

vi.mock('../lib/api', () => ({
  api: {
    getProposals: vi.fn(),
    createProposal: vi.fn(),
    deleteProposal: vi.fn(),
    duplicateProposal: vi.fn(),
  },
}));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [{ id: 'c-lake', name: 'Lakeside Yoga' }] }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../hooks/useAutosave', () => ({
  default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle' }),
}));

const { default: Proposals } = await import('../pages/Proposals');
const { api } = await import('../lib/api');

const list = [
  { id: 'p-1', title: 'Booking site', status: 'VIEWED', total: 6500, viewToken: 'tok-1', client: { name: 'Lakeside Yoga' } },
  { id: 'p-2', title: 'Brand refresh', status: 'DRAFT', total: 1200.5, viewToken: 'tok-2', client: { name: 'Brightpath Law' } },
];

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/proposals']}><Proposals /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Proposals list redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProposals.mockResolvedValue(list);
  });

  it('shows the Sales header and each proposal with its amount and status', async () => {
    renderList();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Proposals to win');
    expect(screen.getByText('Sales')).toHaveClass('text-eyebrow');
    const link = await screen.findByRole('link', { name: 'Booking site' });
    expect(link).toHaveAttribute('href', '/proposal/p-1');
    expect(screen.getByText(formatMoney(6500))).toHaveClass('figure');
    expect(screen.getByText(formatMoney(1200.5))).toBeInTheDocument();
  });

  it('offers the client link for a viewed proposal, and delete only for drafts', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Booking site' });
    expect(screen.getAllByRole('button', { name: 'Copy client link' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
  });

  it('filters by status on the server', async () => {
    renderList();
    await screen.findByRole('link', { name: 'Booking site' });
    const group = screen.getByRole('group', { name: 'Proposal status' });
    fireEvent.click(within(group).getByRole('button', { name: 'Draft' }));
    await waitFor(() => expect(api.getProposals).toHaveBeenLastCalledWith({ status: 'DRAFT' }));
    expect(within(group).getByRole('button', { name: 'Draft' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('labels the new proposal fields', async () => {
    renderList();
    fireEvent.click(screen.getByRole('button', { name: 'New Proposal' }));
    expect(screen.getByLabelText('Client')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes (optional)')).toBeInTheDocument();
  });
});
