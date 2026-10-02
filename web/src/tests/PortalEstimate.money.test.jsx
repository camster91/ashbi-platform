import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({
  api: {
    getEstimateByToken: vi.fn(async () => ({
      title: 'Website', status: 'SENT', clientName: 'Acme',
      lineItems: [{ description: 'Build', quantity: 1, rate: 1500, amount: 1500 }],
      subtotal: 1500, tax: 75, taxRate: 5, total: 1575,
    })),
    approveEstimateByToken: vi.fn(),
  },
}));

const { default: PortalEstimate } = await import('../pages/PortalEstimate');

describe('public estimate money', () => {
  it('formats every amount with the app money formatter', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/portal/estimate/tok']}>
          <Routes>
            <Route path="/portal/estimate/:viewToken" element={<PortalEstimate />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('$1,575.00')).toBeInTheDocument();
    expect(screen.getByText('Tax (5%)')).toBeInTheDocument();
    expect(screen.getByText('$75.00')).toBeInTheDocument();
    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('1,575.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$1500\.00/)).not.toBeInTheDocument();
    // On a phone the rate folds under the description ("1 × $1,500.00").
    expect(screen.getByText('1 × $1,500.00')).toBeInTheDocument();
  });
});
