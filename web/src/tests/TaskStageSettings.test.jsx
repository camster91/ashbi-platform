import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import TaskStageSettings from '../components/TaskStageSettings';
import { buildKanbanColumns } from '../pages/TaskKanban';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: { saveTaskStages: vi.fn(async () => ({})) } }));
const stages = [{ key: 'design', name: 'Design', status: 'IN_PROGRESS' }, { key: 'review', name: 'Review', status: 'REVIEW' }];
function setup() {
  const close = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><TaskStageSettings project={{ id: 'p1', taskStages: stages, boardRevision: 3 }} onClose={close} /></QueryClientProvider>);
  return close;
}
describe('project task stage settings', () => {
  it('renames and reorders stages while retaining their keys and sends the observed revision', async () => {
    const close = setup();
    fireEvent.change(screen.getByLabelText('Stage 1 name'), { target: { value: 'Artwork' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Review earlier' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save stages' }));
    await waitFor(() => expect(api.saveTaskStages).toHaveBeenCalledWith('p1', { revision: 3, stages: [stages[1], { ...stages[0], name: 'Artwork' }] }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
  it('keeps unsaved edits after a conflict and offers a deliberate reload', async () => {
    api.saveTaskStages.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { data: { message: 'Move tasks out of removed stages before saving.' } }));
    const close = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Review' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save stages' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Move tasks out');
    expect(screen.getByLabelText('Stage 1 name')).toHaveValue('Design');
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload board settings' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });
  it('groups custom stages independently of status and never hides unstaged or orphaned tasks', () => {
    const board = { COMPLETED: [{ id: '1', stageKey: 'review', status: 'COMPLETED' }],
      PENDING: [{ id: '2', status: 'PENDING' }, { id: '3', stageKey: 'removed', status: 'PENDING' }] };
    const columns = buildKanbanColumns(board, stages);
    expect(columns.map(column => column.label)).toEqual(['Design', 'Review', 'To Do (no stage)']);
    expect(columns[1].tasks.map(task => task.id)).toEqual(['1']);
    expect(columns.flatMap(column => column.tasks.map(task => task.id)).sort()).toEqual(['1', '2', '3']);
  });
});
