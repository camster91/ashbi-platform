import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getInvoices: vi.fn(),
  getProjects: vi.fn(async () => ({ projects: [] })),
  getLineItemTemplates: vi.fn(async () => []),
  sendInvoice: vi.fn(),
  createInvoice: vi.fn(),
  markInvoicePaid: vi.fn(),
  deleteInvoice: vi.fn(),
};
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

vi.mock('../lib/api', () => ({ api }));
vi.mock('../hooks/useToast', () => ({ useToast: () => toast }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [{ id: 'c1', name: 'Acme' }] }) }));
vi.mock('../hooks/useAutosave', () => ({
  default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle', setDraft: vi.fn(), discardDraft: vi.fn(), saveNow: vi.fn() }),
}));

const { default: Invoices, INVOICE_CSV_HEADERS, invoiceCsvRows } = await import('../pages/Invoices');

const INVOICES = [
  {
    id: 'i1', invoiceNumber: 'INV-1', status: 'SENT', total: 1130, amountPaid: 300, balanceDue: 830, currency: 'CAD',
    client: { name: 'Acme' }, _count: { lineItems: 1 },
  },
  {
    id: 'i2', invoiceNumber: 'INV-2', status: 'SENT', total: 500, amountPaid: 0, balanceDue: 500, currency: 'CAD',
    isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: '2026-11-02T00:00:00.000Z',
    client: { name: 'Beta' }, _count: { lineItems: 1 },
  },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Invoices />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('invoice CSV export', () => {
  it('keeps the stored status code, with the display label in its own column', () => {
    const [partly, recurring] = invoiceCsvRows(INVOICES);
    const status = INVOICE_CSV_HEADERS.indexOf('Status');
    const label = INVOICE_CSV_HEADERS.indexOf('Status label');
    expect([partly[status], partly[label]]).toEqual(['SENT', 'Partly paid']);
    expect([recurring[status], recurring[label]]).toEqual(['SENT', 'Sent']);
    expect(invoiceCsvRows([{ ...INVOICES[1], isOverdue: true }])[0][status]).toBe('OVERDUE');
  });
});

describe('Invoices list', () => {
  beforeEach(() => {
    Object.values(toast).forEach((fn) => fn.mockReset());
    api.getInvoices.mockResolvedValue({ invoices: INVOICES, total: 2, stats: {} });
    api.sendInvoice.mockReset();
  });

  it('shows Partly paid with what is left, and marks recurring invoices', async () => {
    renderPage();
    expect((await screen.findAllByText('Partly paid')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$830.00 CAD left to pay').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Repeats monthly · next on Nov 2, 2026').length).toBeGreaterThan(0);
  });

  it('labels the search and names the status filters in plain words', async () => {
    renderPage();
    expect(await screen.findByLabelText('Search invoices')).toBeInTheDocument();
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    expect(filters.className).toContain('flex-wrap');
    for (const name of ['All', 'Draft', 'Sent', 'Paid', 'Overdue', 'Void']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed');
    }
  });

  it('renders one set of line-item inputs in the new invoice form', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'New Invoice' }));
    // jsdom matches no media query, so the mobile layout is the one rendered;
    // the desktop duplicate (with its own required description) is not.
    expect(screen.getAllByRole('textbox', { name: 'Line item 1 description' })).toHaveLength(1);
  });

  it('shows a VIEWED invoice as Viewed and still offers Mark Paid', async () => {
    api.getInvoices.mockResolvedValue({ invoices: [{ ...INVOICES[1], id: 'v1', invoiceNumber: 'INV-9', status: 'VIEWED', isRecurring: false }], total: 1, stats: {} });
    renderPage();
    expect((await screen.findAllByText('Viewed')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Mark Paid/ }).length).toBeGreaterThan(0);
  });

  it('tells staff when a sent invoice was not emailed', async () => {
    api.getInvoices.mockResolvedValue({ invoices: [{ ...INVOICES[1], id: 'd1', invoiceNumber: 'INV-3', status: 'DRAFT', isRecurring: false }], total: 1, stats: {} });
    api.sendInvoice.mockResolvedValue({ id: 'd1', status: 'SENT', emailSent: false });
    renderPage();
    const [send] = await screen.findAllByRole('button', { name: /Send/ });
    fireEvent.click(send);
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.warning.mock.calls[0][0]).toMatch(/no email went out/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
