import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskViews, { sortViewTasks } from '../pages/TaskViews';
import { api } from '../lib/api';

const rows = [{ id: 't1', title: 'Review artwork', status: 'REVIEW', priority: 'HIGH', dueDate: null }, { id: 't2', title: 'Draft brief', status: 'PENDING', priority: 'NORMAL', dueDate: '2030-01-31T00:00:00Z' }];
let config;
vi.mock('../lib/api', () => ({ api: {
  getTaskViews: vi.fn(async () => config),
  getTasks: vi.fn(async params => ({ tasks: params.status ? rows.filter(row => row.status === params.status) : rows, pagination: { pages: 1 } })),
  saveTaskViews: vi.fn(async (_id, data) => { config = { ...config, views: data.views, revision: data.revision + 1 }; return config; }),
} }));
function setup(initial = '/project/p1/views') {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[initial]}><Routes><Route path="/project/:projectId/views" element={<TaskViews />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { config = { projectId: 'p1', projectName: 'Agency project', views: [], revision: 0, stages: [] }; vi.clearAllMocks(); api.getTasks.mockImplementation(async params => ({ tasks: params.status ? rows.filter(row => row.status === params.status) : rows, pagination: { pages: 1 } })); });
describe('saved task views', () => {
  it('clears archived relation grouping without changing the saved board layout', async () => {
    config.fields = [{ key: 'old', name: 'Archived relation', type: 'RELATION', target: 'CLIENT', archived: true }];
    config.views = [{ key: 'board', name: 'Board', layout: 'BOARD', sort: 'TITLE', filters: {}, columns: ['old'], grouping: { by: 'FIELD', fieldKey: 'old' } }];
    setup('/project/p1/views?view=board');
    fireEvent.click(await screen.findByRole('button', { name: 'Clear unavailable grouping' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear unavailable columns' }));
    expect(screen.getByLabelText('Task view layout')).toHaveValue('BOARD');
    fireEvent.click(screen.getByRole('button', { name: 'Save view changes' }));
    await waitFor(() => expect(config.views[0].grouping).toBeUndefined());
    expect(config.views[0].layout).toBe('BOARD');
    expect(config.views[0].columns).toBeUndefined();
  });
  it('requests authorized relation labels and persists named gallery grouping', async () => {
    config.fields = [{ key: 'client', name: 'Related client', type: 'RELATION', target: 'CLIENT' }];
    api.getTasks.mockImplementation(async params => ({ tasks: params.relationField ? [{ id: 'named', projectId: 'p1', title: 'Named relation', status: 'PENDING', fieldValues: { client: 'c1' }, fieldRelations: { client: { id: 'c1', name: 'Canonical client' } } }, { id: 'missing', projectId: 'p1', title: 'Unavailable relation', status: 'PENDING', fieldValues: { client: 'unknown' }, fieldRelations: { client: null } }] : rows, pagination: { pages: 1 } }));
    const first = setup();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Task view layout'), { target: { value: 'GALLERY' } });
    fireEvent.change(screen.getByLabelText('Task view grouping'), { target: { value: 'FIELD:client' } });
    expect(await screen.findByRole('heading', { name: 'Canonical client (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unavailable related record (1)' })).toBeInTheDocument();
    expect(api.getTasks).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1', relationField: 'client' }));
    fireEvent.change(screen.getByLabelText('Task view name'), { target: { value: 'By client' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new view' }));
    await waitFor(() => expect(config.views[0]?.grouping).toEqual({ by: 'FIELD', fieldKey: 'client' }));
    first.unmount(); setup(`/project/p1/views?view=${config.views[0].key}`);
    expect(await screen.findByRole('heading', { name: 'Canonical client (1)' })).toBeInTheDocument();
  });
  it('saves a grouped gallery and restores it from the selected-view URL', async () => {
    const first = setup();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Task view layout'), { target: { value: 'GALLERY' } });
    fireEvent.change(screen.getByLabelText('Task view grouping'), { target: { value: 'STATUS' } });
    expect(screen.getByRole('region', { name: 'Task gallery' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Task view name'), { target: { value: 'Gallery by status' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new view' }));
    await waitFor(() => expect(config.views[0]?.grouping).toEqual({ by: 'STATUS' }));
    expect(config.views[0].layout).toBe('GALLERY');
    first.unmount();
    setup(`/project/p1/views?view=${config.views[0].key}`);
    await screen.findByRole('region', { name: 'Task gallery' });
    expect(screen.getByLabelText('Task view grouping')).toHaveValue('STATUS');
    expect(await screen.findByRole('heading', { name: 'review (1)' })).toBeInTheDocument();
  });
  it('saves a filtered layout, retains the selected view and allows deletion without deleting tasks', async () => {
    setup();
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('View status filter'), { target: { value: 'REVIEW' } });
    await waitFor(() => expect(screen.queryByText('Draft brief')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Task view name'), { target: { value: 'Review queue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new view' }));
    await waitFor(() => expect(api.saveTaskViews).toHaveBeenCalledWith('p1', { revision: 0, views: [{ key: expect.any(String), name: 'Review queue', layout: 'TABLE', sort: 'PRIORITY', filters: { status: 'REVIEW' } }] }));
    await waitFor(() => expect(screen.getByLabelText('Saved task view')).toHaveValue(config.views[0].key));
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    await waitFor(() => expect(api.saveTaskViews).toHaveBeenLastCalledWith('p1', { revision: 1, views: [] }));
    expect(await screen.findByText('Draft brief')).toBeInTheDocument();
  });
  it('reloads a saved board view from its URL and does not hide legacy task statuses', async () => {
    config.views = [{ key: 'board', name: 'Board', layout: 'BOARD', sort: 'TITLE', filters: {} }];
    setup('/project/p1/views?view=board');
    expect(await screen.findByRole('heading', { name: 'In Review (1)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Task view layout')).toHaveValue('BOARD');
    expect(screen.getByText('Draft brief')).toBeInTheDocument();
  });
  it('keeps unsaved settings after a conflict and shows the actionable server message', async () => {
    api.saveTaskViews.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { data: { message: 'Saved views changed. Reload before saving.' } }));
    setup(); await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Task view name'), { target: { value: 'My queue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save as new view' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved views changed');
    expect(screen.getByLabelText('Task view name')).toHaveValue('My queue');
  });
  it('reloads the saved calendar layout and keeps undated matching tasks visible', async () => {
    config.views = [{ key: 'calendar', name: 'Due dates', layout: 'CALENDAR', sort: 'DUE_DATE', filters: {} }];
    setup('/project/p1/views?view=calendar');
    const calendar = await screen.findByRole('region', { name: 'Task calendar' });
    await waitFor(() => expect(within(calendar).getByText('Review artwork')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2030-01' } });
    expect(within(calendar).getByText('Draft brief')).toBeInTheDocument();
    expect(screen.getByLabelText('Task view layout')).toHaveValue('CALENDAR');
  });
  it('includes later API pages in the table', async () => {
    api.getTasks.mockResolvedValueOnce({ tasks: [rows[0]], pagination: { pages: 2 } });
    api.getTasks.mockResolvedValueOnce({ tasks: [rows[1]], pagination: { pages: 2 } });
    setup();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Draft brief')).toBeInTheDocument();
    expect(api.getTasks).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 100 }));
  });
  it('sorts semantically by priority and keeps undated tasks last', () => {
    expect(sortViewTasks(rows, 'PRIORITY').map(row => row.id)).toEqual(['t1', 't2']);
    expect(sortViewTasks(rows, 'DUE_DATE').map(row => row.id)).toEqual(['t2', 't1']);
    expect(sortViewTasks(rows, 'TITLE').map(row => row.id)).toEqual(['t2', 't1']);
  });
  it('renders typed zero/false values in saved custom columns and preserves the column selection', async () => {
    config.fields = [{ key: 'budget', name: 'Budget', type: 'NUMBER' }, { key: 'approved', name: 'Approval', type: 'BOOLEAN' }];
    config.views = [{ key: 'estimates', name: 'Estimates', layout: 'TABLE', sort: 'TITLE', filters: {}, columns: ['budget', 'approved'] }];
    api.getTasks.mockResolvedValueOnce({ tasks: [{ ...rows[0], fieldValues: { budget: 0, approved: false } }], pagination: { pages: 1 } });
    setup('/project/p1/views?view=estimates');
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Budget' })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: '0', exact: true })).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'No', exact: true })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Budget' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save view changes' }));
    await waitFor(() => expect(api.saveTaskViews).toHaveBeenCalledWith('p1', expect.objectContaining({ views: [expect.objectContaining({ columns: ['budget', 'approved'] })] })));
  });
});
