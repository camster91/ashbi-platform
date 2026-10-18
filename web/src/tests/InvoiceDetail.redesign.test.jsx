import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../hooks/useToast';

const auth = { user: { id: 'u1', role: 'ADMIN' } };

vi.mock('../lib/api', () => ({
  api: {
    getInvoice: vi.fn(),
    getInvoicePayments: vi.fn(),
    sendInvoice: vi.fn(),
    markInvoicePaid: vi.fn(),
    generateInvoicePaymentLink: vi.fn(),
    updateInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    getInvoicePdf: vi.fn(async () => null),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../hooks/useAutosave', () => ({ default: () => ({ draft: null, status: 'idle', clearDraft: async () => {} }) }));
vi.mock('../hooks/useIsSmUp', () => ({ default: () => true }));

const { default: InvoiceDetail, previewViewerName, taxLineLabel } = await import('../pages/InvoiceDetail');
const { api } = await import('../lib/api');

function invoice(overrides = {}) {
  return {
    id: 'i1',
    invoiceNumber: 'INV-1042',
    title: 'Northwind care plan',
    status: 'SENT',
    currency: 'CAD',
    isOverdue: false,
    issueDate: '2026-10-17T12:00:00Z',
    dueDate: '2026-11-01T23:59:59Z',
    sentAt: '2026-10-17T12:00:00Z',
    createdAt: '2026-10-17T12:00:00Z',
    updatedAt: '2026-10-17T12:00:00Z',
    subtotal: 1200,
    discountAmount: 0,
    taxRate: 13,
    taxType: 'HST',
    tax: 156,
    total: 1356,
    amountPaid: 0,
    balanceDue: 1356,
    isRecurring: false,
    recurringInterval: null,
    viewToken: 'view-token',
    stripePaymentLink: null,
    client: { id: 'c1', name: 'Northwind Coffee', contacts: [{ name: 'Priya Shah', email: 'priya@example.com' }] },
    createdBy: { id: 'u1', name: 'Cameron Ashley' },
    lineItems: [
      { id: 'l1', description: 'Monthly care plan · November', itemType: 'LABOR', quantity: 1, unitPrice: 950, total: 950 },
      { id: 'l2', description: 'Priority support hours', itemType: 'LABOR', quantity: 2.5, unitPrice: 100, total: 250 },
    ],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/invoices/i1']}>
        <ToastProvider>
          <Routes>
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/invoices" element={<p>Invoice list</p>} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const region = (name) => screen.getByRole('region', { name });

beforeEach(() => {
  auth.user = { id: 'u1', role: 'ADMIN' };
  vi.clearAllMocks();
  api.getInvoicePayments.mockResolvedValue([]);
});

describe('invoice page money panel', () => {
  it('shows the totals, what was paid and what is still owed for a partly paid invoice', async () => {
    api.getInvoice.mockResolvedValue(invoice({ amountPaid: 300, balanceDue: 1056 }));
    api.getInvoicePayments.mockResolvedValue([
      { id: 'p1', amount: 300, method: 'BANK', paidAt: '2026-10-20T12:00:00Z', transactionId: 'ETR-77', notes: 'Deposit' },
    ]);
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'INV-1042' })).toBeInTheDocument();
    expect(screen.getAllByText('Partly paid').length).toBeGreaterThan(0);
    const lines = region('Line items');
    const sums = within(lines).getByLabelText('Totals');
    expect(within(sums).getByText('Subtotal').closest('div')).toHaveTextContent('1,200.00');
    expect(within(sums).getByText('HST 13%').closest('div')).toHaveTextContent('156.00');
    expect(within(sums).getByText('Total CAD').closest('div')).toHaveTextContent('$1,356.00 CAD');
    expect(within(sums).getByText('Paid so far').closest('div')).toHaveTextContent('-$300.00 CAD');
    expect(within(sums).getByText('Balance due').closest('div')).toHaveTextContent('$1,056.00 CAD');
    expect(within(lines).getByRole('row', { name: /Priority support hours/ })).toHaveTextContent('2.5100.00250.00');

    const history = await screen.findByRole('region', { name: 'Payment history' });
    expect(within(history).getByRole('row', { name: /Bank Transfer/ })).toHaveTextContent('ETR-77');
    expect(within(history).getByRole('row', { name: /Bank Transfer/ })).toHaveTextContent('$300.00 CAD');
  });

  it('previews what the client sees: their name, the balance on the pay button and the pay page link', async () => {
    api.getInvoice.mockResolvedValue(invoice({ amountPaid: 300, balanceDue: 1056 }));
    renderPage();
    const preview = await screen.findByRole('complementary', { name: 'What Priya sees' });
    expect(within(preview).getByText('Pay Now - $1,056.00 CAD')).toBeInTheDocument();
    expect(within(preview).getByText('Total due').closest('div')).toHaveTextContent('$1,356.00 CAD');
    expect(within(preview).getByRole('link', { name: /Open pay page/ })).toHaveAttribute('href', `${window.location.origin}/portal/invoice/view-token`);
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps a USD invoice in USD everywhere', async () => {
    api.getInvoice.mockResolvedValue(invoice({ currency: 'USD' }));
    renderPage();
    const sums = within(await screen.findByRole('region', { name: 'Line items' })).getByLabelText('Totals');
    expect(within(sums).getByText('Total USD').closest('div')).toHaveTextContent('$1,356.00 USD');
    expect(within(region('Details')).getByText('USD')).toBeInTheDocument();
  });

  it('shows a paid invoice as paid, with how it was paid and nothing left to collect', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'PAID', paidAt: '2026-10-25T12:00:00Z', paymentMethod: 'CHECK', amountPaid: 1356, balanceDue: 0 }));
    renderPage();
    const payment = await screen.findByRole('region', { name: 'Payment and schedule' });
    expect(within(payment).getByText('Payment received')).toBeInTheDocument();
    expect(within(payment).getByText(/via Cheque/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void invoice' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).getByText(/^Paid on/)).toBeInTheDocument();
    expect(within(screen.getByRole('complementary')).queryByText(/Pay Now/)).not.toBeInTheDocument();
  });
});

describe('invoice page payment methods', () => {
  it('offers to generate a Stripe payment link for an open invoice', async () => {
    api.getInvoice.mockResolvedValue(invoice());
    api.generateInvoicePaymentLink.mockResolvedValue({ url: 'https://pay.example' });
    renderPage();
    const payment = await screen.findByRole('region', { name: 'Payment and schedule' });
    expect(within(payment).getByText('Bank transfer, e-Transfer, cheque or cash')).toBeInTheDocument();
    await userEvent.click(within(payment).getByRole('button', { name: 'Generate payment link' }));
    expect(api.generateInvoicePaymentLink).toHaveBeenCalledWith('i1');
  });

  it('shows an active payment link with a copy action', async () => {
    api.getInvoice.mockResolvedValue(invoice({ stripePaymentLink: 'https://checkout.example' }));
    renderPage();
    const payment = await screen.findByRole('region', { name: 'Payment and schedule' });
    expect(within(payment).getByText('Payment link active')).toBeInTheDocument();
    expect(within(payment).getByRole('button', { name: 'Copy link' })).toBeEnabled();
    expect(within(payment).queryByRole('button', { name: 'Generate payment link' })).not.toBeInTheDocument();
  });

  it('says how the invoice repeats and when the last reminder went out', async () => {
    api.getInvoice.mockResolvedValue(invoice({ isRecurring: true, recurringInterval: 'MONTHLY', recurringNextDate: '2026-11-17T00:00:00Z', reminderSentAt: '2026-11-04T12:00:00Z' }));
    renderPage();
    const payment = await screen.findByRole('region', { name: 'Payment and schedule' });
    expect(within(payment).getByText('Repeats monthly · next on Nov 17, 2026')).toBeInTheDocument();
    expect(within(payment).getByText(/Last reminder sent/)).toBeInTheDocument();
  });
});

describe('invoice page actions by role', () => {
  it('lets an admin edit, send and void a draft', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', sentAt: null }));
    api.sendInvoice.mockResolvedValue({ emailSent: true });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'INV-1042' });
    expect(screen.getByText('This invoice is a draft. Check the lines, then send.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Void invoice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.getByText(/once you send the invoice/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send invoice' }));
    expect(api.sendInvoice).toHaveBeenCalledWith('i1');
  });

  it('lets a team member edit a draft but not send or void it', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', sentAt: null }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'INV-1042' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Void invoice' })).not.toBeInTheDocument();
  });

  it('keeps reviewed (source-backed) invoices admin-only', async () => {
    auth.user = { id: 'u2', role: 'TEAM' };
    api.getInvoice.mockResolvedValue(invoice({ billingSources: { currency: 'CAD', lineItems: [] } }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'INV-1042' });
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate payment link' })).not.toBeInTheDocument();
    expect(screen.queryByText('Original billed work')).not.toBeInTheDocument();
  });

  it('records a payment for the balance due from the header', async () => {
    api.getInvoice.mockResolvedValue(invoice({ amountPaid: 300, balanceDue: 1056 }));
    api.markInvoicePaid.mockResolvedValue({ status: 'PAID' });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    expect(within(dialog).getByLabelText('Amount received')).toHaveValue(1056);
    expect(within(dialog).getByLabelText('Amount received')).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(api.markInvoicePaid).toHaveBeenCalledWith('i1', { paymentMethod: 'BANK', paymentNotes: '', transactionId: '', amount: 1056 });
  });

  it('hides Void once a payment is recorded', async () => {
    api.getInvoice.mockResolvedValue(invoice({ amountPaid: 300, balanceDue: 1056 }));
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'INV-1042' });
    expect(screen.queryByRole('button', { name: 'Void invoice' })).not.toBeInTheDocument();
  });
});

describe('editing a draft', () => {
  it('edits in the mockup panels, previews the new total live and saves only what changed', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', sentAt: null }));
    api.updateInvoice.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    const form = screen.getByRole('form', { name: 'Edit INV-1042' });
    expect(within(form).getByRole('radio', { name: 'CAD' })).toBeChecked();
    const rate = within(form).getByLabelText('Line 2 rate');
    await userEvent.clear(rate);
    await userEvent.type(rate, '200');
    // 950 + 2.5 × 200 = 1,450 + 13% HST = 1,638.50
    expect(within(form).getByLabelText('Totals')).toHaveTextContent('$1,638.50 CAD');
    expect(within(screen.getByRole('complementary')).getByText('Pay Now - $1,638.50 CAD')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalledTimes(1));
    const [, payload] = api.updateInvoice.mock.calls[0];
    expect(payload).not.toHaveProperty('issueDate');
    expect(payload).not.toHaveProperty('isRecurring');
    expect(payload.lineItems[1]).toMatchObject({ quantity: 2.5, unitPrice: 200 });
  });

  it('sends a changed issue date and a new monthly repeat', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', sentAt: null }));
    api.updateInvoice.mockResolvedValue({});
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const issue = screen.getByLabelText('Issue date');
    await userEvent.clear(issue);
    await userEvent.type(issue, '2026-10-20');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Repeat this invoice' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalledTimes(1));
    expect(api.updateInvoice.mock.calls[0][1]).toMatchObject({ issueDate: '2026-10-20', isRecurring: true, recurringInterval: 'MONTHLY' });
  });

  it('cancels back to the read-only view without saving', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', sentAt: null }));
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(api.updateInvoice).not.toHaveBeenCalled();
  });
});

describe('invoice page states', () => {
  it('shows a loading state while the invoice loads', () => {
    api.getInvoice.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading invoice…' })).toBeInTheDocument();
  });

  it('shows a retryable error when the invoice cannot be loaded', async () => {
    api.getInvoice.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 })).mockResolvedValue(invoice());
    renderPage();
    expect(await screen.findByText('Invoice details could not be loaded')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'INV-1042' })).toBeInTheDocument();
  });

  it('says so when the invoice does not exist', async () => {
    api.getInvoice.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Invoice not found.')).toBeInTheDocument();
  });

  it('keeps the invoice visible when only the payment history fails', async () => {
    api.getInvoice.mockResolvedValue(invoice());
    api.getInvoicePayments.mockRejectedValue(Object.assign(new Error('nope'), { status: 500 }));
    renderPage();
    expect(await screen.findByText('Payment history could not be loaded')).toBeInTheDocument();
    expect(region('Line items')).toBeInTheDocument();
  });

  it('shows an empty line item list plainly', async () => {
    api.getInvoice.mockResolvedValue(invoice({ status: 'DRAFT', lineItems: [], subtotal: 0, tax: 0, total: 0, balanceDue: 0 }));
    renderPage();
    expect(await screen.findByText('No line items yet.')).toBeInTheDocument();
  });
});

describe('invoice page helpers', () => {
  it('labels the tax line and names the preview viewer', () => {
    expect(taxLineLabel('HST', 13)).toBe('HST 13%');
    expect(taxLineLabel('TAX', 5)).toBe('Tax 5%');
    expect(taxLineLabel('NONE', 0)).toBe('No tax');
    expect(previewViewerName({ client: { contacts: [{ name: 'Priya Shah' }] } })).toBe('Priya');
    expect(previewViewerName({ client: { contacts: [] } })).toBeNull();
  });
});
