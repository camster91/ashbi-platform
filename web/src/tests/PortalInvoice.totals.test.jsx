import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPortalInvoice = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getPortalInvoice: (...args) => getPortalInvoice(...args),
    payPortalInvoice: vi.fn(),
  },
}));

const { default: PortalInvoice } = await import('../pages/PortalInvoice');

function invoice(overrides = {}) {
  return {
    id: 'inv-1', invoiceNumber: 'INV-2026-0001', status: 'SENT', currency: 'USD',
    subtotal: 1000, discountAmount: 100, taxType: 'HST', taxRate: 13, tax: 117, total: 1017,
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 1000, total: 1000 }],
    ...overrides,
  };
}

function renderInvoice() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/portal/invoice/tok']}>
        <Routes>
          <Route path="/portal/invoice/:token" element={<PortalInvoice />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public invoice totals', () => {
  beforeEach(() => getPortalInvoice.mockReset());

  it('shows the stored subtotal, discount, tax and total in the invoice currency', async () => {
    getPortalInvoice.mockResolvedValue(invoice());
    renderInvoice();
    expect(await screen.findByRole('button', { name: 'Pay Now - $1,017.00 USD' })).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('-$100.00 USD')).toBeInTheDocument();
    expect(screen.getByText('HST (13%)')).toBeInTheDocument();
    expect(screen.getByText('$117.00 USD')).toBeInTheDocument();
    // The stored total (after discount), not a sum of line items.
    expect(screen.getAllByText('$1,017.00 USD').length).toBeGreaterThan(0);
  });

  it('hides Pay when there is nothing to collect', async () => {
    getPortalInvoice.mockResolvedValue(invoice({ subtotal: 100, discountAmount: 100, tax: 0, total: 0 }));
    renderInvoice();
    expect(await screen.findByText('INV-2026-0001')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay Now/ })).not.toBeInTheDocument();
  });
});
