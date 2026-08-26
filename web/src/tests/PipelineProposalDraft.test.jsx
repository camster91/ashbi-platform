import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Pipeline from '../pages/Pipeline';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPipelineStages: vi.fn(),
    getPipelineAnalytics: vi.fn(),
    createPipelineProposalDraft: vi.fn(),
    updatePipelineDeal: vi.fn(),
    deletePipelineDeal: vi.fn(),
  },
}));

function renderPipeline() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <Pipeline />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('Deal to proposal draft handoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPipelineStages.mockResolvedValue([{
      id: 'stage-1', key: 'stage-1', name: 'Qualified', label: 'Qualified', order: 0,
      probability: 30, count: 1, valuesByCurrency: { CAD: 12000 },
      items: [{
        id: 'deal-1', name: 'Packaging system', title: 'Packaging system', value: 12000,
        total: 12000, currency: 'CAD', clientId: 'client-1', clientName: 'Example Foods',
      }],
    }]);
    api.getPipelineAnalytics.mockResolvedValue({ conversionRates: {} });
    api.createPipelineProposalDraft.mockResolvedValue({
      proposal: { id: 'proposal-1', status: 'DRAFT', currency: 'CAD' },
      idempotent: false,
    });
  });

  it('requires reviewed scope and creates only a draft using the deal currency', async () => {
    renderPipeline();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Expand Qualified stage' }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Create proposal draft for Packaging system' }));
    expect(screen.getByText('Currency: CAD from this deal')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Proposal line item description'), {
      target: { value: 'Reviewed packaging scope' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create draft proposal' }));

    await waitFor(() => {
      expect(api.createPipelineProposalDraft).toHaveBeenCalledWith('deal-1', {
        title: 'Packaging system proposal',
        lineItems: [{ description: 'Reviewed packaging scope', quantity: 1, unitPrice: 12000 }],
      });
    });
    expect(screen.queryByText(/send proposal/i)).not.toBeInTheDocument();
  });
});
