import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Pipeline from '../pages/Pipeline';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPipelineStages: vi.fn(),
    getPipelineAnalytics: vi.fn(),
    getClients: vi.fn(),
    createPipelineDeal: vi.fn(),
  },
}));

function renderPipeline() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Pipeline />
    </QueryClientProvider>,
  );
}

describe('Pipeline currency evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPipelineStages.mockResolvedValue([{
      id: 'stage-1', key: 'stage-1', name: 'Qualified', label: 'Qualified', order: 0,
      probability: 30, count: 2, valuesByCurrency: { CAD: 12000, USD: 8000 }, items: [],
    }]);
    api.getPipelineAnalytics.mockResolvedValue({ conversionRates: {} });
    api.getClients.mockResolvedValue({ clients: [{ id: 'client-1', name: 'Example Foods' }] });
    api.createPipelineDeal.mockResolvedValue({ id: 'deal-1' });
  });

  it('shows CAD and USD stage values separately', async () => {
    renderPipeline();

    expect((await screen.findAllByText('$12,000 CAD')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('$8,000 USD').length).toBeGreaterThan(0);
    expect(screen.queryByText('$20,000')).not.toBeInTheDocument();
  });

  it('requires currency when staff creates a valued deal', async () => {
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'New Deal' }));
    fireEvent.change(await screen.findByLabelText('Deal name'), { target: { value: 'Packaging system' } });
    fireEvent.change(screen.getByLabelText('Client'), { target: { value: 'client-1' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '12000' } });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'CAD' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Deal' }));

    await waitFor(() => {
      expect(api.createPipelineDeal).toHaveBeenCalledWith({
        name: 'Packaging system',
        clientId: 'client-1',
        value: 12000,
        currency: 'CAD',
        stageId: 'stage-1',
      });
    });
  });
});
