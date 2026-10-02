import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  getOverdueInvoices: vi.fn(),
  chaseInvoices: vi.fn(),
};
vi.mock('../lib/api', () => ({ api: new Proxy({}, { get: (_t, prop) => api[prop] ?? vi.fn(async () => ({})) }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const { default: InvoiceChaser, splitReminders, chaseFailureBanner } = await import('../pages/InvoiceChaser');

const invoices = [
  { id: 'inv-1', invoiceNumber: 'INV-001', client: { name: 'Northwind' }, total: 1200, daysOverdue: 10, dueDate: '2026-09-20' },
  { id: 'inv-2', invoiceNumber: 'INV-002', client: { name: 'Contoso' }, total: 800, daysOverdue: 40, dueDate: '2026-08-20' },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><InvoiceChaser /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function cardFor(number) {
  return screen.getByRole('link', { name: number }).closest('.overflow-hidden');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getOverdueInvoices.mockResolvedValue(invoices);
});

describe('invoice chaser failures', () => {
  it('sorts written reminders from failed ones', () => {
    const { written, failed } = splitReminders([
      { invoiceId: 'inv-1', subject: 'Reminder', body: 'Hi' },
      { invoiceId: 'inv-2', error: 'Reminder could not be generated' },
    ]);
    expect(Object.keys(written)).toEqual(['inv-1']);
    expect(failed['inv-2']).toMatch(/couldn't be written/);
  });

  it('says plainly when AI is unavailable', () => {
    const error = Object.assign(new Error("AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings."), { data: { code: 'AI_UNAVAILABLE' } });
    const banner = chaseFailureBanner(error);
    expect(banner.title).toBe('AI is unavailable, so no reminders were written');
    expect(banner.message).toMatch(/Ask an admin to add an AI provider/);
  });

  it('shows a failure next to its invoice, with a retry that works', async () => {
    api.chaseInvoices
      .mockResolvedValueOnce({ reminders: [
        { invoiceId: 'inv-1', subject: 'Friendly reminder', body: 'Hi there', urgency: 'friendly reminder' },
        { invoiceId: 'inv-2', invoiceNumber: 'INV-002', error: 'Reminder could not be generated' },
      ] })
      .mockResolvedValueOnce({ reminders: [{ invoiceId: 'inv-2', subject: 'Final notice', body: 'Please pay' }] });
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Generate All Reminders/ }));
    const failed = await waitFor(() => {
      const card = cardFor('INV-002');
      expect(within(card).getByText(/This reminder couldn't be written/)).toBeInTheDocument();
      return card;
    });
    expect(within(cardFor('INV-001')).queryByText(/couldn't be written/)).not.toBeInTheDocument();

    fireEvent.click(within(failed).getByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(api.chaseInvoices).toHaveBeenLastCalledWith({ invoiceId: 'inv-2' }));
    await waitFor(() => expect(within(cardFor('INV-002')).queryByText(/couldn't be written/)).not.toBeInTheDocument());
    expect(within(cardFor('INV-002')).getByText('Final notice')).toBeInTheDocument();
  });

  it('explains an AI outage once and marks every invoice it stopped', async () => {
    const outage = Object.assign(new Error("AI isn't set up for this workspace yet. Ask an admin to add an AI provider in Settings."), { status: 503, data: { code: 'AI_UNAVAILABLE' } });
    api.chaseInvoices.mockRejectedValue(outage);
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Generate All Reminders/ }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('AI is unavailable, so no reminders were written');
    expect(banner).toHaveTextContent('Ask an admin to add an AI provider in Settings.');
    for (const number of ['INV-001', 'INV-002']) {
      expect(within(cardFor(number)).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    }
  });

  it('after a failed single-invoice retry, "Try again" retries only that invoice', async () => {
    const outage = Object.assign(new Error('The AI provider is unavailable.'), { status: 502, data: { code: 'AI_PROVIDER_UPSTREAM' } });
    api.chaseInvoices.mockRejectedValue(outage);
    renderPage();

    fireEvent.click(await within(await waitFor(() => cardFor('INV-002'))).findByRole('button', { name: /Generate/ }));
    const banner = await screen.findByRole('alert');
    expect(api.chaseInvoices).toHaveBeenLastCalledWith({ invoiceId: 'inv-2' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(api.chaseInvoices).toHaveBeenCalledTimes(2));
    expect(api.chaseInvoices).toHaveBeenLastCalledWith({ invoiceId: 'inv-2' });
  });

  it('lets the header wrap on phones with 44px buttons', async () => {
    renderPage();
    const header = await screen.findByTestId('chaser-header');
    expect(header.className).toMatch(/\bflex-col\b/);
    expect(header.className).toMatch(/\bsm:flex-row\b/);
    const refresh = within(header).getByRole('button', { name: /Refresh/ });
    expect(refresh.parentElement.className).toMatch(/\bflex-wrap\b/);
    expect(refresh.className).toMatch(/min-h-11/);
    expect((await within(header).findByRole('button', { name: /Generate All Reminders/ })).className).toMatch(/min-h-11/);
  });

  it('says so when every reminder in a run failed', async () => {
    api.chaseInvoices.mockResolvedValue({ reminders: invoices.map(inv => ({ invoiceId: inv.id, error: 'Reminder could not be generated' })) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Generate All Reminders/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('None of the reminders could be written');
  });
});
