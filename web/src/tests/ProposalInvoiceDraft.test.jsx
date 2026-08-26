import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProposalDetail from '../pages/ProposalDetail';
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
    getProposal: vi.fn(),
    createInvoiceFromProposal: vi.fn(),
  },
}));

function renderProposalDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/proposals/proposal-1']}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route path="/proposals/:id" element={<ProposalDetail />} />
          <Route path="/invoices" element={<div>Invoices destination</div>} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Proposal to invoice draft review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProposal.mockResolvedValue({
      id: 'proposal-1', title: 'Packaging system', status: 'APPROVED', currency: 'CAD',
      subtotal: 1000, discount: 0, total: 1000, approvedAt: '2026-08-26T12:00:00.000Z',
      client: { name: 'Example Foods' }, createdBy: { name: 'Cameron' },
      lineItems: [{ id: 'line-1', description: 'Packaging design', quantity: 1, unitPrice: 1000 }],
      contract: { id: 'contract-1', status: 'SIGNED' },
    });
    api.createInvoiceFromProposal.mockResolvedValue({ id: 'invoice-1', status: 'DRAFT' });
  });

  it('keeps invoice creation available after a contract exists', async () => {
    renderProposalDetail();

    expect(await screen.findByRole('button', { name: 'Review invoice draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Contract' })).not.toBeInTheDocument();
  });

  it('requires reviewed tax details and explains that no client or payment action occurs', async () => {
    renderProposalDetail();

    fireEvent.click(await screen.findByRole('button', { name: 'Review invoice draft' }));
    expect(screen.getByRole('dialog', { name: 'Review invoice draft' })).toBeInTheDocument();
    expect(screen.getByText(/does not email the client, create a payment link, or charge anything/i)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Create internal draft' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Tax type'), { target: { value: 'NONE' } });
    fireEvent.change(screen.getByLabelText('Tax rate percent'), { target: { value: '0' } });
    fireEvent.click(screen.getByLabelText('I reviewed the tax treatment for this client and work'));
    fireEvent.click(submit);

    await waitFor(() => {
      expect(api.createInvoiceFromProposal).toHaveBeenCalledWith('proposal-1', {
        taxType: 'NONE',
        taxRate: 0,
        taxReviewed: true,
      });
    });
    expect(await screen.findByText('Invoices destination')).toBeInTheDocument();
  });
});
