import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Pipeline from '../pages/Pipeline';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getPipelineStages: vi.fn(),
    getPipelineAnalytics: vi.fn(),
    createPipelineStage: vi.fn(),
    updatePipelineStage: vi.fn(),
    deletePipelineStage: vi.fn(),
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

describe('Pipeline stage manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPipelineStages.mockResolvedValue([]);
    api.getPipelineAnalytics.mockResolvedValue({ conversionRates: {} });
    api.createPipelineStage.mockResolvedValue({ id: 'stage-1', name: 'Qualified' });
  });

  it('creates only the stage a staff member explicitly names', async () => {
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));
    const dialog = screen.getByRole('dialog', { name: 'Manage pipeline stages' });
    fireEvent.change(screen.getByLabelText('New stage name'), { target: { value: 'Qualified' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add stage' }));

    await waitFor(() => {
      expect(api.createPipelineStage).toHaveBeenCalledWith({
        name: 'Qualified',
        probability: 0,
        order: 0,
      });
    });
    expect(dialog).toBeInTheDocument();
  });

  it('does not present missing conversion evidence as zero percent', async () => {
    renderPipeline();

    await screen.findByRole('button', { name: 'Manage stages' });
    expect(screen.queryByText('Conversion Rates (All-Time)')).not.toBeInTheDocument();
    expect(screen.getByText('Conversion rates need verified lifecycle events before they can be reported.')).toBeInTheDocument();
  });

  it('saves an explicit stage name and probability edit', async () => {
    api.getPipelineStages.mockResolvedValue([
      { id: 'stage-1', name: 'Qualified', label: 'Qualified', probability: 40, order: 0, count: 0, items: [] },
    ]);
    api.updatePipelineStage.mockResolvedValue({ id: 'stage-1', name: 'Discovery' });
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));
    fireEvent.change(screen.getByLabelText('Stage name for Qualified'), { target: { value: 'Discovery' } });
    fireEvent.change(screen.getByLabelText('Probability for Qualified'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Qualified' }));

    await waitFor(() => {
      expect(api.updatePipelineStage).toHaveBeenCalledWith('stage-1', {
        name: 'Discovery',
        probability: 25,
      });
    });
  });

  it('does not silently turn a blank probability into zero', async () => {
    api.getPipelineStages.mockResolvedValue([
      { id: 'stage-1', name: 'Qualified', label: 'Qualified', probability: 40, order: 0, count: 0, items: [] },
    ]);
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));
    fireEvent.change(screen.getByLabelText('Probability for Qualified'), { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Save Qualified' })).toBeDisabled();
    expect(api.updatePipelineStage).not.toHaveBeenCalled();
  });

  it('requires an explicit destination before deleting a populated stage', async () => {
    api.getPipelineStages.mockResolvedValue([
      { id: 'stage-1', name: 'Qualified', label: 'Qualified', probability: 40, order: 0, count: 2, items: [] },
      { id: 'stage-2', name: 'Discovery', label: 'Discovery', probability: 60, order: 1, count: 0, items: [] },
    ]);
    api.deletePipelineStage.mockResolvedValue({ id: 'stage-1' });
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));
    const deleteButton = screen.getByRole('button', { name: 'Delete Qualified' });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Move deals from Qualified to'), { target: { value: 'stage-2' } });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 deals and delete stage' }));

    await waitFor(() => {
      expect(api.deletePipelineStage).toHaveBeenCalledWith('stage-1', 'stage-2');
    });
  });

  it('deletes an empty stage only after confirmation and without a destination', async () => {
    api.getPipelineStages.mockResolvedValue([
      { id: 'stage-1', name: 'Dormant', label: 'Dormant', probability: 0, order: 0, count: 0, items: [] },
    ]);
    api.deletePipelineStage.mockResolvedValue({ id: 'stage-1' });
    renderPipeline();

    fireEvent.click(await screen.findByRole('button', { name: 'Manage stages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Dormant' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete stage' }));

    await waitFor(() => {
      expect(api.deletePipelineStage).toHaveBeenCalledWith('stage-1', undefined);
    });
  });
});
