import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProposal = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getProposal: (...args) => getProposal(...args),
    updateProposal: vi.fn(),
    sendProposal: vi.fn(),
    createContractFromProposal: vi.fn(),
    createInvoiceFromProposal: vi.fn(),
  },
}));
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('../hooks/useAutosave', () => ({
  default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle' }),
}));

const { default: ProposalDetail } = await import('../pages/ProposalDetail');

function approvedProposal(overrides = {}) {
  return {
    id: 'prop-1',
    title: 'Website rebuild',
    status: 'APPROVED',
    approvedAt: '2026-09-01T00:00:00.000Z',
    client: { name: 'Acme' },
    createdBy: { name: 'Cameron' },
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 1000, total: 1000 }],
    subtotal: 1000,
    discount: 0,
    total: 1000,
    contract: null,
    ...overrides,
  };
}

function renderDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/proposal/prop-1']}>
        <Routes>
          <Route path="/proposal/:id" element={<ProposalDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('approved proposal invoicing', () => {
  beforeEach(() => getProposal.mockReset());

  it('offers contract generation and invoicing before a contract exists', async () => {
    getProposal.mockResolvedValue(approvedProposal());
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Create Invoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Contract' })).toBeInTheDocument();
  });

  it('still offers invoicing once approval has auto-generated the contract', async () => {
    getProposal.mockResolvedValue(approvedProposal({ contract: { id: 'ctr-1', status: 'SIGNED' } }));
    renderDetail();
    expect(await screen.findByRole('button', { name: 'Create Invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate Contract' })).not.toBeInTheDocument();
  });
});
