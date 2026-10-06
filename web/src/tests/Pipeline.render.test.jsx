import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Pipeline, { STAGE_ORDER_MAX, defaultOpenStageIds, normalizePipelineStages, planNewStage } from '../pages/Pipeline';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPipelineStages: vi.fn(),
    getPipelineAnalytics: vi.fn(),
    getClients: vi.fn(),
    createPipelineDeal: vi.fn(),
    updatePipelineDeal: vi.fn(),
    deletePipelineDeal: vi.fn(),
    createPipelineStage: vi.fn(),
    updatePipelineStage: vi.fn(),
    deletePipelineStage: vi.fn(),
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
  it('shows the deals of the open stage without a tap, and collapses on request', async () => {
    const user = userEvent.setup();
    api.getPipelineStages.mockResolvedValue(STAGES);
    api.getPipelineAnalytics.mockResolvedValue({ totalDeals: 2, totalPipelineValue: 15000, winRate: 0, averageWinProbability: 15 });
    renderPipeline();

    // The test viewport is narrow (matchMedia does not match), so one stage —
    // the first with deals — starts open and the others start collapsed.
    const list = await screen.findByRole('list', { name: 'Lead deals' });
    const leadToggle = screen.getByRole('button', { name: /^Lead/ });
    expect(leadToggle).toHaveAttribute('aria-expanded', 'true');
    expect(leadToggle).toHaveTextContent('2 deals · $15,000');
    expect(leadToggle).not.toHaveTextContent('--');
    expect(screen.getByRole('button', { name: /^Won/ })).toHaveAttribute('aria-expanded', 'false');
    // aria-controls only names a panel that is rendered.
    expect(leadToggle).toHaveAttribute('aria-controls', 'pipeline-stage-s1');
    expect(screen.getByRole('button', { name: /^Won/ })).not.toHaveAttribute('aria-controls');

    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Website redesign')).toBeInTheDocument();
    expect(within(items[0]).getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/client/c1');
    expect(within(items[0]).getByRole('button', { name: 'Delete Website redesign' })).toBeInTheDocument();
    expect(within(items[0]).getByRole('button', { name: 'Move Website redesign to another stage' })).toBeInTheDocument();

    await user.click(leadToggle);
    expect(screen.queryByRole('list', { name: 'Lead deals' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Won/ }));
    expect(await screen.findByText('No deals in this stage')).toBeInTheDocument();
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

describe('defaultOpenStageIds', () => {
  const stages = normalizePipelineStages([
    { id: 'a', name: 'Lead', deals: [] },
    { id: 'b', name: 'Proposal', deals: [{ id: 'd', value: 1 }] },
    { id: 'c', name: 'Won', deals: [] },
  ]);

  it('opens every stage on a wide screen', () => {
    expect(defaultOpenStageIds(stages, true)).toEqual(['a', 'b', 'c']);
  });

  it('opens one stage on a phone: the first that has deals', () => {
    expect(defaultOpenStageIds(stages, false)).toEqual(['b']);
    expect(defaultOpenStageIds(normalizePipelineStages([{ id: 'x', name: 'X' }]), false)).toEqual(['x']);
    expect(defaultOpenStageIds([], false)).toEqual([]);
  });
});

describe('Manage stages', () => {
  const STAGES_3 = [
    ...STAGES,
    { id: 's3', name: 'Lost', color: '#EF4444', order: 2, probability: 0, deals: [] },
  ];

  async function openManager(user) {
    api.getPipelineStages.mockResolvedValue(STAGES_3);
    api.getPipelineAnalytics.mockResolvedValue({});
    renderPipeline();
    await user.click(await screen.findByRole('button', { name: 'Manage stages' }));
    return screen.getByRole('dialog', { name: 'Manage stages' });
  }

  it('adds a stage before the Won stage by default, moving the later stages down', async () => {
    const user = userEvent.setup();
    api.createPipelineStage.mockResolvedValue({ id: 's4' });
    api.updatePipelineStage.mockResolvedValue({});
    const dialog = await openManager(user);

    expect(within(dialog).getByLabelText('Place it')).toHaveValue('s2');
    await user.type(within(dialog).getByLabelText('New stage name'), '  Negotiation ');
    await user.click(within(dialog).getByRole('button', { name: 'Add stage' }));
    await waitFor(() => expect(api.createPipelineStage).toHaveBeenCalledWith({ name: 'Negotiation', order: 1, probability: 55 }));
    expect(api.updatePipelineStage).toHaveBeenCalledWith('s2', { order: 2 });
    expect(api.updatePipelineStage).toHaveBeenCalledWith('s3', { order: 3 });
  });

  it('can add a stage at the end instead', async () => {
    const user = userEvent.setup();
    api.createPipelineStage.mockResolvedValue({ id: 's4' });
    const dialog = await openManager(user);

    await user.selectOptions(within(dialog).getByLabelText('Place it'), '');
    await user.type(within(dialog).getByLabelText('New stage name'), 'On hold');
    await user.click(within(dialog).getByRole('button', { name: 'Add stage' }));
    await waitFor(() => expect(api.createPipelineStage).toHaveBeenCalledWith({ name: 'On hold', order: 3, probability: 0 }));
    expect(api.updatePipelineStage).not.toHaveBeenCalled();
  });

  it('renames a stage', async () => {
    const user = userEvent.setup();
    api.updatePipelineStage.mockResolvedValue({});
    const dialog = await openManager(user);

    const input = within(dialog).getByLabelText('Stage 2 name');
    expect(input).toHaveValue('Won');
    await user.clear(input);
    await user.type(input, 'Closed won');
    const [, renameWon] = within(dialog).getAllByRole('button', { name: 'Rename' });
    await user.click(renameWon);
    expect(api.updatePipelineStage).toHaveBeenCalledWith('s2', { name: 'Closed won' });
  });

  it('deletes an empty stage without asking where to move deals', async () => {
    const user = userEvent.setup();
    api.deletePipelineStage.mockResolvedValue({});
    const dialog = await openManager(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete Won stage' }));
    expect(within(dialog).getByText('This stage has no deals.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete stage' }));
    expect(api.deletePipelineStage).toHaveBeenCalledWith('s2', undefined);
    // The stage's row is gone; focus moves to adding a stage.
    await waitFor(() => expect(within(dialog).getByLabelText('New stage name')).toHaveFocus());
  });

  it('returns focus to the delete button when a stage delete is cancelled', async () => {
    const user = userEvent.setup();
    const dialog = await openManager(user);
    const trigger = within(dialog).getByRole('button', { name: 'Delete Won stage' });
    await user.click(trigger);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(api.deletePipelineStage).not.toHaveBeenCalled();
  });

  it('asks where to move the deals before deleting a stage that has some', async () => {
    const user = userEvent.setup();
    api.deletePipelineStage.mockResolvedValue({});
    const dialog = await openManager(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete Lead stage' }));
    const destination = within(dialog).getByLabelText('Move its 2 deals to');
    expect(within(destination).getAllByRole('option').map((o) => o.textContent)).toEqual(['Won', 'Lost']);
    await user.selectOptions(destination, 's3');
    await user.click(within(dialog).getByRole('button', { name: 'Move deals and delete' }));
    expect(api.deletePipelineStage).toHaveBeenCalledWith('s1', 's3');
  });

  it('asks for a destination when the API answers 409 for a stage that gained deals', async () => {
    const user = userEvent.setup();
    const conflict = Object.assign(new Error('Move this stage\'s deals to another stage before deleting it'), { status: 409 });
    api.deletePipelineStage.mockRejectedValueOnce(conflict).mockResolvedValueOnce({});
    const dialog = await openManager(user);

    await user.click(within(dialog).getByRole('button', { name: 'Delete Won stage' }));
    await user.click(within(dialog).getByRole('button', { name: 'Delete stage' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Choose where to move them');
    const destination = within(dialog).getByLabelText('Move its deals to');
    await user.selectOptions(destination, 's1');
    await user.click(within(dialog).getByRole('button', { name: 'Move deals and delete' }));
    await waitFor(() => expect(api.deletePipelineStage).toHaveBeenLastCalledWith('s2', 's1'));
  });
});

describe('planNewStage', () => {
  const stages = [
    { id: 'a', order: 0, probability: 10 },
    { id: 'b', order: 1, probability: 75 },
    { id: 'c', order: 2, probability: 100 },
  ];

  it('places before a stage with a probability between its neighbours', () => {
    expect(planNewStage(stages, 'c')).toEqual({ order: 2, probability: 88, shifts: [{ id: 'c', order: 3 }] });
    expect(planNewStage(stages, 'a')).toEqual({
      order: 0, probability: 5, shifts: [{ id: 'a', order: 1 }, { id: 'b', order: 2 }, { id: 'c', order: 3 }],
    });
  });

  it('places at the end, and for the first stage starts at 50%', () => {
    expect(planNewStage(stages, '')).toEqual({ order: 3, probability: 100, shifts: [] });
    expect(planNewStage([], '')).toEqual({ order: 0, probability: 50, shifts: [] });
  });

  it('keeps order within the schema maximum', () => {
    const high = [{ id: 'x', order: STAGE_ORDER_MAX, probability: 40 }];
    expect(planNewStage(high, '').order).toBe(STAGE_ORDER_MAX);
    expect(planNewStage(high, 'x').shifts).toEqual([{ id: 'x', order: STAGE_ORDER_MAX }]);
  });
});
