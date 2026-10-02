import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const getClient = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getClient: (...args) => getClient(...args),
    getClientInsights: vi.fn(async () => null),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));

const { default: Client } = await import('../pages/Client');

function client(overrides = {}) {
  return {
    id: 'c1', name: 'Acme Corporation With A Long Name', status: 'ACTIVE', contacts: [], projects: [], threads: [],
    invoices: [{
      id: 'i1', invoiceNumber: 'INV-1', status: 'SENT', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD', isOverdue: false,
    }],
    totalRevenue: 0, revenueByCurrency: {}, revenueCurrency: null,
    outstandingBalance: 830, outstandingCurrency: 'CAD', outstandingByCurrency: { CAD: 830 },
    ...overrides,
  };
}

function renderClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/client/c1']}>
        <Routes><Route path="/client/:id" element={<Client />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('client page money', () => {
  it('shows the outstanding balance after payments, and the partly paid invoice', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    expect(await screen.findByText('outstanding')).toBeInTheDocument();
    expect(screen.getByText('$830.00')).toBeInTheDocument();
    expect(screen.queryByText('$1,130.00 outstanding')).not.toBeInTheDocument();
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
    expect(screen.getByText('$830.00 left to pay')).toBeInTheDocument();
  });

  it('lists each currency apart when the client owes in several', async () => {
    getClient.mockResolvedValue(client({ outstandingBalance: null, outstandingCurrency: null, outstandingByCurrency: { CAD: 830, USD: 99 } }));
    renderClient();
    expect(await screen.findByText('$830.00 · US$99.00')).toBeInTheDocument();
  });

  it('lets the header wrap so the status badge stays on screen', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    const heading = await screen.findByRole('heading', { level: 1, name: /Acme Corporation/ });
    expect(heading.parentElement.className).toContain('min-w-0');
    expect(heading.parentElement.parentElement.className).toContain('flex-wrap');
  });
});
