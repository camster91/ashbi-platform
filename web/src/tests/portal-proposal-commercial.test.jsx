import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalProposal from '../pages/PortalProposal';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPortalProposal: vi.fn(),
    respondPortalProposal: vi.fn(),
  },
}));

function proposal(overrides = {}) {
  return {
    id: 'proposal-1',
    title: 'AI workflow implementation',
    status: 'VIEWED',
    currency: 'CAD',
    subtotal: 1200,
    discount: 200,
    total: 1000,
    notes: 'Includes discovery, implementation, and training.',
    sentAt: '2026-08-20T12:00:00.000Z',
    validUntil: '2099-09-30T12:00:00.000Z',
    client: { id: 'client-1', name: 'Example Client' },
    project: { id: 'project-1', name: 'Workflow modernization' },
    lineItems: [{ id: 'line-1', description: 'Implementation', quantity: 1, unitPrice: 1200, total: 1200 }],
    ...overrides,
  };
}

function renderProposal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/portal/proposal/test-token']}>
        <Routes><Route path="/portal/proposal/:token" element={<PortalProposal />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portal proposal commercial evidence', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders the public API client, notes, dates, subtotal, discount, and total with verified currency', async () => {
    api.getPortalProposal.mockResolvedValue(proposal());
    renderProposal();

    expect(await screen.findByText('Example Client')).toBeInTheDocument();
    expect(screen.getByText('Includes discovery, implementation, and training.')).toBeInTheDocument();
    expect(screen.getByText(/Sent Aug 20/)).toBeInTheDocument();
    expect(screen.getByText(/Valid until Sep 30, 2099/)).toBeInTheDocument();
    expect(screen.getByText('Subtotal')).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText(/−CAD\s*200\.00/)).toBeInTheDocument();
    expect(screen.getAllByText(/CAD\s*1,000\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Approve Proposal' })).toBeEnabled();
  });

  it('withholds approval but preserves decline when legacy currency evidence is unresolved', async () => {
    api.getPortalProposal.mockResolvedValue(proposal({ currency: null }));
    renderProposal();

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval is unavailable because this proposal currency has not been verified.');
    expect(screen.getAllByText(/currency unassigned/).length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByRole('button', { name: 'Approve Proposal' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeEnabled();
  });
});
