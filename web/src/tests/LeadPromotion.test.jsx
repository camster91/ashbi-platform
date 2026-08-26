import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeadInbox from '../pages/LeadInbox';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getQualifiedLeads: vi.fn(),
    getQualifiedLead: vi.fn(),
    getPipelineStages: vi.fn(),
    updateLeadQualification: vi.fn(),
    convertQualifiedLead: vi.fn(),
    promoteQualifiedLead: vi.fn(),
  },
}));

vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function renderInbox() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LeadInbox />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Qualified inquiry pipeline promotion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const lead = {
      id: 'lead-1', name: 'Casey Founder', email: 'casey@example.com', company: 'Example Foods',
      serviceLine: 'brand_packaging', status: 'QUALIFIED', budgetBand: '10k_25k',
      budgetCurrency: 'CAD', timing: 'this_quarter', businessContext: 'Launching a new product.',
      requestedOutcome: 'A shelf-ready brand and packaging system.', qualificationNotes: 'Human reviewed.',
      convertedClientId: null, convertedDealId: null, createdAt: '2026-08-26T20:00:00.000Z',
      events: [],
    };
    api.getQualifiedLeads.mockResolvedValue({ leads: [lead] });
    api.getQualifiedLead.mockResolvedValue(lead);
    api.getPipelineStages.mockResolvedValue([
      { id: 'stage-1', label: 'Qualified', name: 'Qualified', order: 0 },
    ]);
    api.promoteQualifiedLead.mockResolvedValue({
      leadId: 'lead-1', clientId: 'client-1', dealId: 'deal-1', idempotent: false,
    });
  });

  it('requires staff to choose explicit deal evidence before promotion', async () => {
    renderInbox();

    fireEvent.click(await screen.findByRole('button', { name: /Example Foods/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add to pipeline' }));
    fireEvent.change(await screen.findByLabelText('Deal name'), { target: { value: 'Example Foods brand system' } });
    fireEvent.change(screen.getByLabelText('Pipeline stage'), { target: { value: 'stage-1' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'CAD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review pipeline promotion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create client and deal' }));

    await waitFor(() => {
      expect(api.promoteQualifiedLead).toHaveBeenCalledWith('lead-1', {
        name: 'Example Foods brand system',
        stageId: 'stage-1',
        value: 12000,
        currency: 'CAD',
      });
    });
  });
});
