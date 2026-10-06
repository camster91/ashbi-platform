// Issue #531: the public portal pages show the sending agency's own name and
// logo from the API's `brand`, never one hard-coded agency's name.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPortalInvoice = vi.fn();
const getEstimateByToken = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getPortalInvoice: (...args) => getPortalInvoice(...args),
    payPortalInvoice: vi.fn(),
    getEstimateByToken: (...args) => getEstimateByToken(...args),
    approveEstimateByToken: vi.fn(),
  },
}));

const { default: PortalInvoice } = await import('../pages/PortalInvoice');
const { default: PortalEstimate } = await import('../pages/PortalEstimate');

function invoice(overrides = {}) {
  return {
    id: 'inv-1', invoiceNumber: 'INV-2026-0001', status: 'SENT', currency: 'USD',
    subtotal: 1000, discountAmount: 0, taxType: 'HST', taxRate: 13, tax: 130, total: 1130,
    lineItems: [{ id: 'li-1', description: 'Design', quantity: 1, unitPrice: 1000, total: 1000 }],
    ...overrides,
  };
}

function renderAt(pathname, routePath, element) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('public invoice branding', () => {
  beforeEach(() => getPortalInvoice.mockReset());

  it("shows the sending agency's name and logo from the API", async () => {
    getPortalInvoice.mockResolvedValue(invoice({
      brand: { companyName: 'Northwind Studio', logoUrl: 'https://cdn.northwind.test/logo.png' },
    }));
    const { container } = renderAt('/portal/invoice/tok', '/portal/invoice/:token', <PortalInvoice />);
    expect(await screen.findByText('INV-2026-0001')).toBeInTheDocument();
    expect(screen.getAllByText('Northwind Studio').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: 'Northwind Studio logo' })).toHaveAttribute('src', 'https://cdn.northwind.test/logo.png');
    expect(container.textContent).not.toMatch(/Ashbi Design/);
  });

  it('shows nothing brand-specific when the API sends no brand', async () => {
    getPortalInvoice.mockResolvedValue(invoice());
    const { container } = renderAt('/portal/invoice/tok', '/portal/invoice/:token', <PortalInvoice />);
    expect(await screen.findByText('INV-2026-0001')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-brand')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Ashbi Design|Powered by/);
  });

  it('never loads a non-https logo URL', async () => {
    getPortalInvoice.mockResolvedValue(invoice({ brand: { companyName: 'Northwind Studio', logoUrl: 'javascript:alert(1)' } }));
    renderAt('/portal/invoice/tok', '/portal/invoice/:token', <PortalInvoice />);
    expect(await screen.findByText('INV-2026-0001')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});

describe('public estimate branding', () => {
  beforeEach(() => getEstimateByToken.mockReset());

  it('names the agency the estimate is from', async () => {
    getEstimateByToken.mockResolvedValue({
      title: 'Website refresh', status: 'SENT', lineItems: [], subtotal: 100, tax: 0, total: 100,
      clientName: 'Avery Client', createdAt: '2026-09-01T00:00:00.000Z',
      brand: { companyName: 'Northwind Studio', logoUrl: null },
    });
    const { container } = renderAt('/portal/estimate/tok', '/portal/estimate/:viewToken', <PortalEstimate />);
    expect(await screen.findByText('Website refresh')).toBeInTheDocument();
    expect(screen.getAllByText('Northwind Studio').length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/Ashbi Design/);
  });
});

describe('client-facing portal sources', () => {
  const pages = [
    'Portal.jsx', 'PortalBooking.jsx', 'PortalContract.jsx', 'PortalEstimate.jsx', 'PortalIntakeForm.jsx',
    'PortalInvoice.jsx', 'PortalProposal.jsx', 'PortalReview.jsx', 'ClientPortal.jsx',
    'client-portal/DocumentsTab.jsx', 'client-portal/ProjectDetail.jsx', 'client-portal/ReviewsTab.jsx', 'client-portal/shared.jsx',
  ];

  it.each(pages)('%s hard-codes no agency name or domain', (page) => {
    const source = readFileSync(path.resolve(__dirname, '../pages', page), 'utf8');
    expect(source).not.toMatch(/Ashbi Design|ASHBI|ashbi\.ca/);
  });
});
