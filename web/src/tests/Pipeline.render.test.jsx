import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Pipeline, { normalizePipelineStages } from '../pages/Pipeline';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPipelineStages: vi.fn(),
    getPipelineAnalytics: vi.fn(),
    getClients: vi.fn(),
    createPipelineDeal: vi.fn(),
    updatePipelineDeal: vi.fn(),
    deletePipelineDeal: vi.fn(),
    aiChat: vi.fn(),
  },
}));

// The shape GET /pipeline returns: { id, name, deals } per stage.
const STAGES = [
  {
    id: 's1', name: 'Lead', color: '#8B5CF6', order: 0, probability: 10,
    deals: [
      { id: 'd1', title: 'Website redesign', value: 12000, probability: 20, client: { id: 'c1', name: 'Acme' } },
      { id: 'd2', title: 'SEO retainer', value: 3000, probability: 10, client: { id: 'c2', name: 'Globex' } },
    ],
  },
  { id: 's2', name: 'Won', color: '#10B981', order: 1, probability: 100, deals: [] },
];

function renderPipeline() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter><Pipeline /></MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('normalizePipelineStages', () => {
  it('derives the count and value from stage.deals', () => {
    const [lead, won] = normalizePipelineStages(STAGES);
    expect(lead.count).toBe(2);
    expect(lead.value).toBe(15000);
    expect(won.count).toBe(0);
    expect(won.deals).toEqual([]);
  });

  it('tolerates malformed payloads', () => {
    expect(normalizePipelineStages(undefined)).toEqual([]);
    expect(normalizePipelineStages({ stages: [{ id: 's', name: 'X' }] })[0].deals).toEqual([]);
  });
});

describe('Pipeline page', () => {
  it('renders each stage from stage.name and its stage.deals', async () => {
    const user = userEvent.setup();
    api.getPipelineStages.mockResolvedValue(STAGES);
    api.getPipelineAnalytics.mockResolvedValue({ totalDeals: 2, totalPipelineValue: 15000, winRate: 0, averageWinProbability: 15 });
    renderPipeline();

    const [expandLead] = await screen.findAllByRole('button', { name: 'Expand Lead stage' });
    await user.click(expandLead);

    const list = screen.getByRole('list', { name: 'Lead deals' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Website redesign')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/client/c1');
    expect(within(items[0]).getByRole('button', { name: 'Delete Website redesign' })).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Move Website redesign to another stage' })).toBeInTheDocument();
  });

  it('creates a deal with the PipelineDeal field names and requires a client', async () => {
    const user = userEvent.setup();
    api.getPipelineStages.mockResolvedValue(STAGES);
    api.getPipelineAnalytics.mockResolvedValue({});
    api.getClients.mockResolvedValue({ clients: [{ id: 'c1', name: 'Acme' }], total: 1 });
    api.createPipelineDeal.mockResolvedValue({ id: 'd3' });
    renderPipeline();

    await user.click(await screen.findByRole('button', { name: /New Deal/ }));
    await user.type(screen.getByLabelText(/Deal name/), 'Brand refresh');
    await user.type(screen.getByLabelText('Value ($)'), '4000');
    await user.click(screen.getByRole('button', { name: 'Create Deal' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose the client this deal is for');
    expect(api.createPipelineDeal).not.toHaveBeenCalled();

    await screen.findByRole('option', { name: 'Acme' });
    await user.selectOptions(screen.getByLabelText(/Client/), 'c1');
    await user.click(screen.getByRole('button', { name: 'Create Deal' }));
    expect(api.createPipelineDeal).toHaveBeenCalledWith({ title: 'Brand refresh', clientId: 'c1', stageId: 's1', value: 4000 });
  });
});
