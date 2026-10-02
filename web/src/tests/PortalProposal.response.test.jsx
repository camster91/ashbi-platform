import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const respondPortalProposal = vi.fn();
const getPortalProposal = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getPortalProposal: (...args) => getPortalProposal(...args),
    respondPortalProposal: (...args) => respondPortalProposal(...args),
  },
}));

const { default: PortalProposal } = await import('../pages/PortalProposal');

const PROPOSAL = {
  id: 'prop-1',
  title: 'Website rebuild',
  status: 'VIEWED',
  total: 2500,
  lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 2500, total: 2500 }],
};

function renderProposal() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/portal/proposal/tok']}>
        <Routes>
          <Route path="/portal/proposal/:token" element={<PortalProposal />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public proposal response confirmation', () => {
  beforeEach(() => {
    getPortalProposal.mockReset();
    getPortalProposal.mockResolvedValue(PROPOSAL);
    respondPortalProposal.mockReset();
    respondPortalProposal.mockResolvedValue({ success: true });
  });

  it('confirms an approval as approved', async () => {
    renderProposal();
    fireEvent.click(await screen.findByRole('button', { name: /Approve Proposal/ }));
    expect(await screen.findByRole('heading', { name: 'Proposal Approved' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proposal Declined' })).not.toBeInTheDocument();
    expect(respondPortalProposal).toHaveBeenCalledWith('tok', { action: 'approve' });
  });

  it('confirms a decline as declined', async () => {
    renderProposal();
    fireEvent.click(await screen.findByRole('button', { name: /Decline/ }));
    fireEvent.change(screen.getByLabelText('Reason for declining proposal'), { target: { value: 'Over budget' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit Decline/ }));
    expect(await screen.findByRole('heading', { name: 'Proposal Declined' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Proposal Approved' })).not.toBeInTheDocument();
  });
});

describe('public proposal money', () => {
  beforeEach(() => getPortalProposal.mockReset());

  it('shows the tax and the total the invoice will bill, in the app money format', async () => {
    getPortalProposal.mockResolvedValue({
      ...PROPOSAL,
      subtotal: 1500, discount: 0, total: 1500,
      taxRate: 5, taxType: 'TAX', tax: 75, totalWithTax: 1575,
      lineItems: [{ id: 'li-1', description: 'Website', quantity: 1, unitPrice: 1500, total: 1500 }],
    });
    renderProposal();
    expect(await screen.findByText('$1,575.00')).toBeInTheDocument();
    expect(screen.getByText('Tax (5%)')).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    // Line amounts carry the symbol and thousands separator.
    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThan(0);
    expect(screen.queryByText(/1500\.00/)).not.toBeInTheDocument();
    // A zero discount is not shown.
    expect(screen.queryByText('Discount')).not.toBeInTheDocument();
  });

  it('shows a real discount', async () => {
    getPortalProposal.mockResolvedValue({
      ...PROPOSAL, subtotal: 1000, discount: 100, total: 900, taxRate: 13, taxType: 'HST', tax: 117, totalWithTax: 1017,
    });
    renderProposal();
    expect(await screen.findByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('-$100.00')).toBeInTheDocument();
    expect(screen.getByText('HST (13%)')).toBeInTheDocument();
    expect(screen.getByText('$1,017.00')).toBeInTheDocument();
  });
});
