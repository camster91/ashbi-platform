import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Proposals from '../pages/Proposals';
import { api } from '../lib/api';

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../lib/api', () => ({
  default: {
    getDraft: vi.fn().mockResolvedValue({ draft: null, revision: null }),
    saveDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    clearDraft: vi.fn().mockResolvedValue({}),
  },
  api: {
    getProposals: vi.fn(),
    getClients: vi.fn(),
    createProposal: vi.fn(),
    getDraft: vi.fn().mockResolvedValue({ draft: null, revision: null }),
    saveDraft: vi.fn().mockResolvedValue({ revision: 1 }),
    clearDraft: vi.fn().mockResolvedValue({}),
  },
}));

function renderProposals() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Proposals />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Proposal currency evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProposals.mockResolvedValue([]);
    api.getClients.mockResolvedValue({ clients: [{ id: 'client-1', name: 'Example Foods' }] });
    api.getDraft.mockResolvedValue({ draft: null, revision: null });
    api.createProposal.mockResolvedValue({ id: 'proposal-1' });
  });

  it('requires staff to choose CAD or USD for a new proposal', async () => {
    renderProposals();

    fireEvent.click(await screen.findByRole('button', { name: 'New Proposal' }));
    fireEvent.change(screen.getByLabelText('Proposal client'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'Packaging proposal' } });
    fireEvent.change(screen.getByLabelText('Proposal currency'), { target: { value: 'CAD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create proposal' }));

    await waitFor(() => {
      expect(api.createProposal).toHaveBeenCalledWith({
        clientId: 'client-1',
        title: 'Packaging proposal',
        notes: '',
        currency: 'CAD',
        lineItems: [{ description: 'Service', quantity: 1, unitPrice: 0 }],
      });
    });
  });

  it('labels proposal totals with their currency', async () => {
    api.getProposals.mockResolvedValue([{
      id: 'proposal-1', title: 'Packaging proposal', status: 'DRAFT', total: 12000,
      currency: 'CAD', client: { name: 'Example Foods' },
    }]);
    renderProposals();

    expect(await screen.findByText('$12,000.00 CAD')).toBeInTheDocument();
  });
});
