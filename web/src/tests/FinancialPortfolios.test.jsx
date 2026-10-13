import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Invoices from '../pages/Invoices';
import Expenses from '../pages/Expenses';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { getInvoices: vi.fn(), getExpenses: vi.fn(), getExpenseSummary: vi.fn(), getProjects: vi.fn(async () => ({ projects: [] })), getLineItemTemplates: vi.fn(async () => []) } }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'ADMIN' } }) }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [] }) }));
vi.mock('../hooks/useAutosave', () => ({ default: () => ({ draft: null, clearDraft: vi.fn(), status: 'idle', setDraft: vi.fn(), discardDraft: vi.fn(), saveNow: vi.fn() }) }));
function setup(component, url) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}>{component}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => vi.clearAllMocks());
it('retains the invoice portfolio and loads later rows without carrying old filtered rows', async () => {
  api.getInvoices.mockImplementation(async ({ portfolio, offset }) => ({ invoices: [{ id: `${portfolio}-${offset}`, invoiceNumber: `${portfolio}-${offset}`, status: 'DRAFT', total: 10, currency: 'CAD', client: { name: 'Canonical client' }, _count: { lineItems: 1 } }], total: portfolio === 'FREELANCE' ? 2 : 1, stats: {} }));
  setup(<Invoices />, '/invoices?portfolio=FREELANCE');
  expect((await screen.findAllByRole('link', { name: 'FREELANCE-0' }))[0]).toHaveAttribute('href', '/invoices/FREELANCE-0');
  fireEvent.click(screen.getByRole('button', { name: 'Load more invoices' }));
  expect((await screen.findAllByRole('link', { name: 'FREELANCE-1' }))[0]).toHaveAttribute('href', '/invoices/FREELANCE-1');
  fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: 'ASHBI_DESIGN' } });
  expect((await screen.findAllByRole('link', { name: 'ASHBI_DESIGN-0' }))[0]).toHaveAttribute('href', '/invoices/ASHBI_DESIGN-0');
  expect(screen.queryAllByRole('link', { name: 'FREELANCE-1' })).toHaveLength(0);
  expect(api.getInvoices).toHaveBeenLastCalledWith({ portfolio: 'ASHBI_DESIGN', offset: 0, limit: 100 });
});
it('shows separate expense currencies and refetches portfolio totals with the list', async () => {
  api.getExpenses.mockImplementation(async ({ offset }) => ({ expenses: [{ id: `expense-${offset}`, description: `Receipt ${offset}`, amount: 7, currency: 'CAD', category: 'SOFTWARE', date: '2026-10-13' }], total: 2 }));
  api.getExpenseSummary.mockResolvedValue({ currencies: ['CAD', 'USD'], mixedCurrency: true, totalThisMonth: null, allTimeTotal: null, allTimeCount: 2, byCurrency: { CAD: { totalThisMonth: 15, allTimeTotal: 25, byCategory: {} }, USD: { totalThisMonth: 30, allTimeTotal: 50, byCategory: {} } } });
  setup(<Expenses />, '/expenses?portfolio=FREELANCE');
  expect(await screen.findByText('$25.00')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Expense summary currency'), { target: { value: 'USD' } });
  expect(screen.getByText('US$50.00')).toBeInTheDocument();
  expect(screen.queryByText('$75.00')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load more expenses' }));
  expect(await screen.findByText('Receipt 1')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: 'UNCLASSIFIED' } });
  await waitFor(() => expect(api.getExpenseSummary).toHaveBeenLastCalledWith({ portfolio: 'UNCLASSIFIED' }));
  expect(api.getExpenses).toHaveBeenLastCalledWith({ portfolio: 'UNCLASSIFIED', offset: 0, limit: 100 });
});
