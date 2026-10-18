import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getClient = vi.fn();
const getRetainerList = vi.fn();
const auth = { user: { id: 'u1', role: 'ADMIN' } };

vi.mock('../lib/api', () => ({
  api: {
    getClient: (...args) => getClient(...args),
    getClientInsights: vi.fn(async () => null),
    getRetainerList: (...args) => getRetainerList(...args),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
// Staff panels have their own tests; here they only need to be present.
vi.mock('../components/ClientAccountManager', () => ({ default: () => <p>Account manager panel</p> }));
vi.mock('../components/ClientServicePanels', () => ({ default: () => <p>Saved reports panel</p> }));
vi.mock('../components/ClientCommunications', () => ({ default: () => <p>Stored messages panel</p> }));

const { default: Client } = await import('../pages/Client');

function client(overrides = {}) {
  return {
    id: 'c1', name: 'Acme Corporation With A Long Name', status: 'ACTIVE', createdAt: '2025-03-10T12:00:00Z',
    contacts: [], projects: [], threads: [],
    invoices: [{
      id: 'i1', invoiceNumber: 'INV-1', title: 'Care plan', status: 'SENT', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD', isOverdue: false,
    }],
    totalRevenue: 0, revenueByCurrency: {}, revenueCurrency: null,
    outstandingBalance: 830, outstandingCurrency: 'CAD', outstandingByCurrency: { CAD: 830 },
    ...overrides,
  };
}

function Where() {
  const location = useLocation();
  return <output aria-label="location">{location.search}</output>;
}

function renderClient(path = '/client/c1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/client/:id" element={<><Client /><Where /></>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.user = { id: 'u1', role: 'ADMIN' };
  getClient.mockReset();
  getRetainerList.mockReset().mockResolvedValue([]);
});

describe('client page money', () => {
  it('shows the outstanding balance after payments, and the partly paid invoice', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    const numbers = await screen.findByRole('region', { name: 'Client numbers' });
    expect(within(numbers).getByText('Outstanding').nextSibling).toHaveTextContent('$830.00');
    expect(screen.queryByText('$1,130.00 outstanding')).not.toBeInTheDocument();
    expect(screen.getByText('Partly paid')).toBeInTheDocument();
    expect(screen.getByText('$830.00 left to pay')).toBeInTheDocument();
  });

  it('lists each currency apart when the client owes in several', async () => {
    getClient.mockResolvedValue(client({ outstandingBalance: null, outstandingCurrency: null, outstandingByCurrency: { CAD: 830, USD: 99 } }));
    renderClient();
    expect(await screen.findByText('$830.00 · US$99.00')).toBeInTheDocument();
  });

  it('works out how many days the client usually takes to pay', async () => {
    getClient.mockResolvedValue(client({
      invoices: [
        { id: 'a', invoiceNumber: 'INV-2', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', sentAt: '2026-09-01T00:00:00Z', paidAt: '2026-09-05T00:00:00Z' },
        { id: 'b', invoiceNumber: 'INV-3', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', issueDate: '2026-08-01T00:00:00Z', paidAt: '2026-08-07T00:00:00Z' },
        { id: 'c', invoiceNumber: 'INV-4', status: 'PAID', total: 100, amountPaid: 100, currency: 'CAD', sentAt: '2026-07-01T00:00:00Z', paidAt: '2026-07-21T00:00:00Z' },
      ],
    }));
    renderClient();
    const numbers = await screen.findByRole('region', { name: 'Client numbers' });
    expect(within(numbers).getByText('Usually pays in').nextSibling).toHaveTextContent('6 days');
  });

  it('shows the retainer card for this client only', async () => {
    getClient.mockResolvedValue(client());
    getRetainerList.mockResolvedValue([
      { id: 'r0', clientId: 'other', serviceDescription: 'Someone else', hoursPerMonth: 10, hoursUsed: 1, currency: 'CAD', monthlyAmountCad: 500 },
      { id: 'r1', clientId: 'c1', serviceDescription: 'Monthly care plan', hoursPerMonth: 20, hoursUsed: 4.5, currency: 'CAD', monthlyAmountCad: 1200, billingDay: 1, retainerStatus: 'ACTIVE' },
    ]);
    renderClient();
    const card = await screen.findByRole('region', { name: 'Monthly care plan' });
    expect(card).toHaveTextContent('$1,200.00 a month');
    expect(card).toHaveTextContent('4.5 of 20 hours used');
    expect(screen.queryByText('Someone else')).not.toBeInTheDocument();
  });
});

describe('client page layout', () => {
  it('lets the header wrap so the status stays on screen, with the full name as the heading', async () => {
    getClient.mockResolvedValue(client());
    renderClient();
    const heading = await screen.findByRole('heading', { level: 1, name: 'Acme Corporation With A Long Name' });
    expect(heading.parentElement.className).toContain('min-w-0');
    expect(heading.closest('.flex-wrap')).not.toBeNull();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Client since March 2025/)).toBeInTheDocument();
    expect(screen.getByText('Bills in CAD')).toBeInTheDocument();
  });

  it('opens a tab from the address and keeps the choice in it', async () => {
    const user = userEvent.setup();
    getClient.mockResolvedValue(client({
      projects: [
        { id: 'p1', name: 'Holiday landing page', status: 'DESIGN_DEV', health: 'ON_TRACK', _count: { tasks: 10, threads: 2 } },
        { id: 'p2', name: 'Old site', status: 'LAUNCHED', health: 'ON_TRACK', _count: { tasks: 3, threads: 0 } },
      ],
    }));
    renderClient('/client/c1?tab=projects&conversationId=x1');
    expect(await screen.findByRole('tab', { name: /Projects/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Old site/ })).toHaveAttribute('href', '/project/p2');

    await user.click(screen.getByRole('tab', { name: /Overview/ }));
    expect(screen.getByLabelText('location')).toHaveTextContent('?conversationId=x1');
    // Overview lists open projects only.
    expect(screen.getByRole('link', { name: /Holiday landing page/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Old site/ })).not.toBeInTheDocument();
    expect(screen.getByText('Account manager panel')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /Invoices/ }));
    expect(screen.getByLabelText('location')).toHaveTextContent('tab=invoices');
    expect(screen.getByRole('link', { name: 'INV-1' })).toHaveAttribute('href', '/invoices/i1');
  });

  it('shows team members no money and makes no retainer request', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    getClient.mockResolvedValue(client());
    renderClient('/client/c1?tab=invoices');
    expect(await screen.findByRole('tab', { name: /Overview/, selected: true })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Invoices/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Outstanding')).not.toBeInTheDocument();
    expect(screen.queryByText('INV-1')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New invoice/ })).not.toBeInTheDocument();
    expect(getRetainerList).not.toHaveBeenCalled();
    expect(screen.getByText('Account manager panel')).toBeInTheDocument();
  });
});
