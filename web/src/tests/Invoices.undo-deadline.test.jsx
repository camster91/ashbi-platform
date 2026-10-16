import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Invoices from '../pages/Invoices';
import InvoiceDetail from '../pages/InvoiceDetail';
import { ToastProvider } from '../hooks/useToast';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: {
  getInvoices: vi.fn(), getInvoice: vi.fn(), getInvoicePayments: vi.fn(),
  getProjects: vi.fn(), getLineItemTemplates: vi.fn(), deleteInvoice: vi.fn(), undoInvoiceVoid: vi.fn(),
} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'admin', role: 'ADMIN' } }) }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [] }) }));
vi.mock('../hooks/useAutosave', () => ({ default: () => ({ draft: null, status: 'idle' }) }));
const invoice = { id: 'i1', invoiceNumber: 'INV-1', status: 'DRAFT', total: 100, balanceDue: 100, amountPaid: 0, currency: 'CAD', lineItems: [], client: { name: 'Acme' }, _count: { lineItems: 0 } };
const caches = [];
let clock;
beforeEach(() => {
  vi.resetAllMocks();
  clock = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  api.getInvoices.mockResolvedValue({ invoices: [invoice], total: 1, stats: {} });
  api.getInvoice.mockResolvedValue(invoice);
  api.getInvoicePayments.mockResolvedValue([]);
  api.getProjects.mockResolvedValue({ projects: [] });
  api.getLineItemTemplates.mockResolvedValue([]);
  api.deleteInvoice.mockImplementation(async () => ({ undoExpiresAt: new Date(clock + 10000).toISOString() }));
});
afterEach(() => { caches.splice(0).forEach(cache => cache.clear()); vi.restoreAllMocks(); });
function Location() { return <output aria-label="Current path">{useLocation().pathname}</output>; }
async function voidInvoice(page) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  caches.push(cache);
  const invalidate = vi.spyOn(cache, 'invalidateQueries');
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[page === 'list' ? '/invoices' : '/invoices/i1']}><ToastProvider><Location /><Routes><Route path="/invoices" element={<Invoices />} /><Route path="/invoices/:id" element={<InvoiceDetail />} /></Routes></ToastProvider></MemoryRouter></QueryClientProvider>);
  const buttons = await screen.findAllByRole('button', { name: 'Void invoice', exact: true });
  fireEvent.click(buttons[0]);
  const dialog = screen.getByRole('dialog', { name: 'Void invoice' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Void invoice', exact: true }));
  await screen.findByText('INV-1 voided');
  return { undo: screen.getByRole('button', { name: 'Undo void INV-1' }), invalidate };
}

describe.each(['list', 'detail'])('%s invoice Undo workflow', page => {
  it('refreshes the exact invoice caches and returns to detail only after success, including late response', async () => {
    let resolve;
    api.undoInvoiceVoid.mockImplementation(() => new Promise(done => { resolve = done; }));
    const { undo, invalidate } = await voidInvoice(page);
    expect(screen.getByLabelText('Current path')).toHaveTextContent('/invoices');
    fireEvent.mouseEnter(screen.getByText('INV-1 voided').closest('[role="status"]'));
    invalidate.mockClear();
    fireEvent.click(undo);
    fireEvent.click(undo);
    expect(api.undoInvoiceVoid).toHaveBeenCalledExactlyOnceWith('i1');
    expect(undo).toBeDisabled();
    clock += 11000;
    await act(async () => resolve({ restored: true }));
    await screen.findByText('INV-1 restored');
    expect(undo).not.toBeInTheDocument();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] });
    if (page === 'detail') {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoice', 'i1'] });
      expect(screen.getByLabelText('Current path')).toHaveTextContent('/invoices/i1');
    }
  });

  it('retains a still-valid action after non-expiry failure for explicit retry', async () => {
    api.undoInvoiceVoid.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ restored: true });
    const { undo } = await voidInvoice(page);
    fireEvent.click(undo);
    await screen.findByText('Could not restore invoice');
    await waitFor(() => expect(undo).not.toBeDisabled());
    expect(screen.queryByText('INV-1 restored')).not.toBeInTheDocument();
    fireEvent.click(undo);
    await screen.findByText('INV-1 restored');
    expect(api.undoInvoiceVoid).toHaveBeenCalledTimes(2);
  });

  it('keeps server 410 final and removes Undo', async () => {
    api.undoInvoiceVoid.mockRejectedValueOnce(Object.assign(new Error('Window closed'), { status: 410 }));
    const { undo } = await voidInvoice(page);
    fireEvent.click(undo);
    await screen.findByText('Invoice void undo expired');
    await waitFor(() => expect(undo).not.toBeInTheDocument());
    expect(screen.queryByText('INV-1 restored')).not.toBeInTheDocument();
    expect(api.undoInvoiceVoid).toHaveBeenCalledOnce();
  });

  it.each(['expired', 'malformed'])('does not advertise Undo for a delayed %s response', async deadline => {
    api.deleteInvoice.mockResolvedValue({ undoExpiresAt: deadline === 'expired' ? new Date(clock - 1000).toISOString() : 'bad deadline' });
    const { undo } = await voidInvoice(page);
    expect(screen.getByText('Undo window expired')).toBeInTheDocument();
    expect(undo).toBeDisabled();
    expect(screen.queryByText(/Undo available for/)).not.toBeInTheDocument();
    fireEvent.click(undo);
    expect(api.undoInvoiceVoid).not.toHaveBeenCalled();
  });
});
