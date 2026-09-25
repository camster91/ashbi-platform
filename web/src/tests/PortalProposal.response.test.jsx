import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const respondPortalProposal = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getPortalProposal: vi.fn(async () => ({
      id: 'prop-1',
      title: 'Website rebuild',
      status: 'VIEWED',
      total: 2500,
      lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 2500, total: 2500 }],
    })),
    respondPortalProposal: (...args) => respondPortalProposal(...args),
  },
}));

const { default: PortalProposal } = await import('../pages/PortalProposal');

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
