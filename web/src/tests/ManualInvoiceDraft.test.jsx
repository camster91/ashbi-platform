import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Invoices from '../pages/Invoices';
import { api } from '../lib/api';

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'ADMIN' } }),
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock('../hooks/useAutosave', () => ({
  default: () => ({
    draft: null, draftMeta: null, status: 'idle', lastSaved: null,
    clearDraft: vi.fn().mockResolvedValue(undefined), setDraft: vi.fn(),
    discardDraft: vi.fn(), saveNow: vi.fn(),
  }),
}));

vi.mock('../lib/api', () => ({
  api: {
    getInvoices: vi.fn(),
    getClients: vi.fn(),
    getProjects: vi.fn(),
    getLineItemTemplates: vi.fn(),
    createInvoice: vi.fn(),
  },
}));

function renderInvoices() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Invoices />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Manual invoice draft review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getInvoices.mockResolvedValue({ invoices: [], stats: {} });
    api.getClients.mockResolvedValue({ clients: [{ id: 'client-1', name: 'Example Foods' }] });
    api.getProjects.mockResolvedValue({ projects: [] });
    api.getLineItemTemplates.mockResolvedValue([]);
    api.createInvoice.mockResolvedValue({ id: 'invoice-1', status: 'DRAFT' });
  });

  it('starts without guessed currency or tax values and explains the internal-only result', async () => {
    renderInvoices();
    fireEvent.click(await screen.findByRole('button', { name: 'New Invoice' }));

    expect(screen.getByLabelText('Invoice currency')).toHaveValue('');
    expect(screen.getByLabelText('Tax type')).toHaveValue('');
    expect(screen.getByLabelText('Tax rate percent')).toHaveValue(null);
    expect(screen.getByText(/does not email the client, create a payment link, or charge anything/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create internal draft' })).toBeDisabled();
  });

  it('submits a deliberate currency and reviewed zero-tax draft without invented optional values', async () => {
    renderInvoices();
    fireEvent.click(await screen.findByRole('button', { name: 'New Invoice' }));

    fireEvent.change(screen.getByLabelText('Invoice client'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText('Invoice currency'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Tax type'), { target: { value: 'NONE' } });
    fireEvent.change(screen.getByLabelText('Tax rate percent'), { target: { value: '0' } });
    fireEvent.change(screen.getAllByLabelText('Line item description')[0], {
      target: { value: 'Custom AI workflow' },
    });
    fireEvent.change(screen.getAllByLabelText('Line item unit price')[0], {
      target: { value: '2500' },
    });
    fireEvent.click(screen.getByLabelText('I reviewed the tax treatment for this client and work'));
    fireEvent.click(screen.getByRole('button', { name: 'Create internal draft' }));

    await waitFor(() => {
      expect(api.createInvoice).toHaveBeenCalledWith({
        creationRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        clientId: 'client-1',
        currency: 'USD',
        taxRate: 0,
        taxType: 'NONE',
        taxReviewed: true,
        discountAmount: 0,
        isRecurring: false,
        lineItems: [{
          description: 'Custom AI workflow', itemType: 'LABOR', quantity: 1, unitPrice: 2500,
        }],
      });
    });
  });
});
