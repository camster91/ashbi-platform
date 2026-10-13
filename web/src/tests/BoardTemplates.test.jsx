import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BoardTemplates from '../pages/BoardTemplates';
import { api } from '../lib/api';

let rows;
vi.mock('../lib/api', () => ({ api: {
  getProject: vi.fn(async () => ({ id: 'p1', name: 'Source board', clientId: 'c1', client: { id: 'c1', name: 'Northwind' } })),
  getClients: vi.fn(async () => ({ clients: [{ id: 'c1', name: 'Northwind' }, { id: 'c2', name: 'Ashbi client' }] })),
  getBoardTemplates: vi.fn(async archived => ({ items: rows.filter(row => archived || row.kind === 'BOARD'), nextCursor: null })),
  saveBoardTemplate: vi.fn(async () => ({ id: 'new-template' })),
  archiveBoardTemplate: vi.fn(async (id, archived) => { rows = rows.map(row => row.id === id ? { ...row, kind: archived ? 'BOARD_ARCHIVED' : 'BOARD' } : row); return {}; }),
  createProjectFromBoardTemplate: vi.fn(async () => ({ id: 'created' })),
} }));
function setup() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={['/project/p1/templates']}><Routes>
    <Route path="/project/:projectId/templates" element={<BoardTemplates />} /><Route path="/project/created/kanban" element={<p>Created project board</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); rows = [{ id: 't1', name: 'Design delivery', kind: 'BOARD', boardConfig: { stages: [{}], views: [], fields: [] } }]; });
describe('board templates', () => {
  it('saves only a source-project reference and descriptive metadata', async () => {
    setup(); await screen.findByRole('heading', { name: 'Board templates' });
    fireEvent.change(screen.getByLabelText('Board template name'), { target: { value: 'Branding board' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save board template' }));
    await waitFor(() => expect(api.saveBoardTemplate).toHaveBeenCalledWith({ projectId: 'p1', name: 'Branding board', description: '' }));
  });
  it('creates an empty project using an explicit canonical client and shared work portfolio', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Use Design delivery' }));
    fireEvent.change(screen.getByLabelText('Template project name'), { target: { value: 'New brand project' } });
    fireEvent.change(screen.getByLabelText('Template project client'), { target: { value: 'c2' } });
    fireEvent.change(screen.getByLabelText('Template project portfolio'), { target: { value: 'FREELANCE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project from template' }));
    await waitFor(() => expect(api.createProjectFromBoardTemplate).toHaveBeenCalledWith({ templateId: 't1', clientId: 'c2', name: 'New brand project', portfolio: 'FREELANCE' }));
    expect(await screen.findByText('Created project board')).toBeInTheDocument();
  });
  it('archives and restores a template instead of deleting its configuration', async () => {
    setup(); fireEvent.click(await screen.findByRole('button', { name: 'Archive Design delivery' }));
    await screen.findByText('No board templates yet.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived templates' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Design delivery' }));
    await waitFor(() => expect(api.archiveBoardTemplate).toHaveBeenLastCalledWith('t1', false));
    expect(await screen.findByRole('button', { name: 'Use Design delivery' })).toBeInTheDocument();
  });
});
