import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortalInvoice from '../pages/PortalInvoice';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPortalInvoice: vi.fn(),
    payPortalInvoice: vi.fn(),
  },
}));

function invoice(overrides = {}) {
  return {
    id: 'invoice-1',
    invoiceNumber: 'INV-001',
    status: 'SENT',
    currency: 'CAD',
    title: 'Website delivery',
    notes: 'Thank you for working with Ashbi.',
    client: { id: 'client-1', name: 'Example Client' },
    subtotal: 100,
    discountAmount: 0,
    taxType: 'HST',
    taxRate: 13,
    tax: 13,
    total: 113,
    lineItems: [{ id: 'line-1', description: 'Design service', quantity: 1, unitPrice: 100, total: 100 }],
    ...overrides,
  };
}

function renderInvoice() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/portal/invoice/test-token']}>
        <Routes><Route path="/portal/invoice/:token" element={<PortalInvoice />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('portal invoice currency boundary', () => {
  afterEach(() => vi.clearAllMocks());

  it('labels the payment action and all displayed amounts with verified CAD evidence', async () => {
    api.getPortalInvoice.mockResolvedValue(invoice());
    renderInvoice();

    expect(await screen.findByRole('button', { name: /Pay Now - CAD\s*113\.00/ })).toBeEnabled();
    expect(screen.getAllByText(/CAD\s*100\.00/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/CAD\s*13\.00/)).toBeInTheDocument();
  });

  it('shows unresolved amounts but does not offer Stripe checkout without verified currency', async () => {
    api.getPortalInvoice.mockResolvedValue(invoice({ currency: null }));
    renderInvoice();

    expect(await screen.findByRole('alert')).toHaveTextContent('Payment is unavailable because this invoice currency has not been verified.');
    expect(screen.getAllByText(/currency unassigned/).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByRole('button', { name: /Pay Now/ })).not.toBeInTheDocument();
  });

  it('renders the public API client, title, notes, discount, and reviewed tax evidence', async () => {
    api.getPortalInvoice.mockResolvedValue(invoice({ discountAmount: 10, tax: 11.7, total: 101.7 }));
    renderInvoice();

    expect(await screen.findByText('For: Example Client')).toBeInTheDocument();
    expect(screen.getByText('Website delivery')).toBeInTheDocument();
    expect(screen.getByText('Thank you for working with Ashbi.')).toBeInTheDocument();
    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText(/−CAD\s*10\.00/)).toBeInTheDocument();
    expect(screen.getByText('HST (13%)')).toBeInTheDocument();
    expect(screen.getAllByText(/CAD\s*101\.70/)).toHaveLength(2);
  });
});
