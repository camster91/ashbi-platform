import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TaskCustomFields from '../components/TaskCustomFields';
import TaskFieldSettings from '../pages/TaskFieldSettings';
import { api } from '../lib/api';

let config;
vi.mock('../lib/api', () => ({ api: { getTaskFields: vi.fn(async () => config), getTaskFieldOptions: vi.fn(async () => ({ items: [{ id: 'c1', name: 'Northwind' }] })),
  saveTaskFields: vi.fn(async () => ({})), getTaskFieldDefinitions: vi.fn(async () => config), saveTaskFieldDefinitions: vi.fn(async (_id, body) => ({ ...config, ...body, revision: body.revision + 1 })),
} }));
function setup(settings = false) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/project/p1/fields']}>
    {settings ? <Routes><Route path="/project/:projectId/fields" element={<TaskFieldSettings />} /></Routes> : <TaskCustomFields taskId="t1" />}
  </MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  config = { projectId: 'p1', projectName: 'Agency', revision: 2, definitionRevision: 1, values: { budget: 0, approved: false, old: 'Preserved' }, relations: {}, fields: [
    { key: 'budget', name: 'Budget', type: 'NUMBER', archived: false }, { key: 'approved', name: 'Approval required', type: 'BOOLEAN', archived: false },
    { key: 'client', name: 'Related client', type: 'RELATION', target: 'CLIENT', archived: false }, { key: 'old', name: 'Archived', type: 'TEXT', archived: true },
  ] };
});
describe('typed task fields', () => {
  it('retains zero/false values, chooses a related record and saves only typed field data', async () => {
    setup();
    expect(await screen.findByLabelText('Budget')).toHaveValue(0);
    expect(screen.getByLabelText('Approval required')).toHaveValue('false');
    expect(screen.queryByLabelText('Archived')).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'Northwind' });
    fireEvent.change(screen.getByLabelText('Related client'), { target: { value: 'c1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save custom fields' }));
    await waitFor(() => expect(api.saveTaskFields).toHaveBeenCalledWith('t1', { revision: 2, definitionRevision: 1, values: { budget: 0, approved: false, client: 'c1' } }));
  });
  it('retains a stale draft after a conflict and supports explicit reload', async () => {
    api.saveTaskFields.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { data: { message: 'Fields changed. Reload before saving.' } }));
    setup(); await screen.findByLabelText('Budget');
    fireEvent.change(screen.getByLabelText('Budget'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save custom fields' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fields changed');
    expect(screen.getByLabelText('Budget')).toHaveValue(25);
    fireEvent.click(screen.getByRole('button', { name: 'Reload custom fields' }));
    await waitFor(() => expect(screen.getByLabelText('Budget')).toHaveValue(0));
  });
  it('adds shared definitions while preserving stored keys/types and archives instead of deleting', async () => {
    setup(true); await screen.findByRole('heading', { name: 'Task fields — Agency' });
    expect(screen.getByLabelText('Field 1 type')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    const input = screen.getAllByRole('textbox').find(item => item.value === '');
    fireEvent.change(input, { target: { value: 'Next action' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save field definitions' }));
    await waitFor(() => expect(api.saveTaskFieldDefinitions).toHaveBeenCalledWith('p1', { revision: 2, fields: expect.arrayContaining([expect.objectContaining({ key: 'budget', archived: true }), expect.objectContaining({ name: 'Next action', type: 'TEXT' })]) }));
  });
});
