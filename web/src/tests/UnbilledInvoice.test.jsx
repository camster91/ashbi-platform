import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';

const { billingTool } = vi.hoisted(() => ({ billingTool: vi.fn() }));
vi.mock('../lib/api', () => ({ api: { billingTool } }));
vi.mock('../hooks/useClients', () => ({ default: () => ({ data: [{ id: 'client', name: 'Acme' }] }), useClientSearch: () => ({ data: [] }) }));
import UnbilledInvoice from '../pages/UnbilledInvoice';

const preview = { kind: 'create_unbilled_invoice_draft', client: { name: 'Acme' }, title: 'Design', currency: 'CAD', taxType: 'NONE', taxRate: 0,
  totals: { total: 50, tax: 0 }, lineItems: [{ description: 'Approved design', quantity: 1, unitPrice: 50, total: 50, source: { id: 'time', date: '2026-10-14', project: { name: 'Site' } } }] };
const action = { id: 'receipt', status: 'PENDING_CONFIRMATION', preview, expiresAt: '2026-10-14T02:00:00Z' };
beforeEach(() => { billingTool.mockReset(); });
it('previews exact selections and never confirms until the user explicitly confirms; lost confirmation retrieves its receipt', async () => {
  billingTool.mockImplementation(async (name, body) => {
    if (name === 'list_unbilled_candidates') return { output: { items: body.kind === 'TIME' ? [{ id: 'time', description: 'Approved design', duration: 60, date: '2026-10-14', updatedAt: '2026-10-14T00:00:00Z', suggestedHourlyRate: 0 }] : [], nextCursor: null } };
    if (name === 'preview_unbilled_invoice') return { output: { fingerprint: 'a'.repeat(64) } };
    if (name === 'create_unbilled_invoice_draft') return { action };
    if (name === 'confirm_action') throw new Error('Response lost');
    if (name === 'get_action') return { action: { ...action, status: 'EXECUTED', result: { id: 'invoice' } } };
    throw new Error(`Unexpected operation: ${name}`);
  });
  render(<MemoryRouter><UnbilledInvoice /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'client' } });
  fireEvent.change(screen.getByLabelText('Invoice title'), { target: { value: 'Design' } });
  fireEvent.click(screen.getByText('Load unbilled work'));
  await screen.findByLabelText('Approved design');
  fireEvent.click(screen.getByLabelText('Approved design'));
  fireEvent.change(screen.getByLabelText('Hourly rate for Approved design (CAD)'), { target: { value: '50' } });
  fireEvent.click(screen.getByText('Preview draft invoice'));
  await screen.findByText('Confirm draft creation');
  expect(billingTool.mock.calls.some(([name]) => name === 'confirm_action')).toBe(false);
  expect(billingTool.mock.calls.find(([name]) => name === 'preview_unbilled_invoice')[1].times[0].hourlyRate).toBe(50);
  fireEvent.click(screen.getByText('Confirm draft creation'));
  await screen.findByText('Response lost');
  fireEvent.click(screen.getByText('Retrieve receipt'));
  await screen.findByText('Open invoice');
  expect(billingTool.mock.calls.filter(([name]) => name === 'create_unbilled_invoice_draft')).toHaveLength(1);
});
it('reload can recover a receipt from the URL without creating or executing an action', async () => {
  billingTool.mockResolvedValue({ action: { ...action, status: 'EXECUTED', result: { id: 'invoice' } } });
  render(<MemoryRouter initialEntries={['/invoices/unbilled?action=receipt']}><UnbilledInvoice /></MemoryRouter>);
  expect(screen.getByLabelText('Action receipt ID').value).toBe('receipt');
  fireEvent.click(screen.getByText('Retrieve receipt'));
  await waitFor(() => expect(screen.getByText('Open invoice')).toBeTruthy());
  expect(billingTool).toHaveBeenCalledExactlyOnceWith('get_action', { actionId: 'receipt' });
});
