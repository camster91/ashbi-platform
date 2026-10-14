import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { it, expect, vi } from 'vitest';
import ProjectBoards from '../pages/ProjectBoards';
import { api } from '../lib/api';

const rows = [{ id: 'DEFAULT', name: 'Project board', isDefault: true, taskCount: 2 }, { id: 'b1', name: 'Delivery', revision: 3, taskCount: 1, archivedAt: null }];
vi.mock('../lib/api', () => ({ api: { getProjectBoards: vi.fn(async () => ({ items: rows, nextCursor: null })), createProjectBoard: vi.fn(async () => ({})), updateProjectBoard: vi.fn(async () => ({})) } }));
it('links distinct project boards and archives with the observed metadata revision', async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/project/p1/boards']}><Routes><Route path="/project/:projectId/boards" element={<ProjectBoards />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('heading', { name: 'Delivery' });
  expect(screen.getAllByRole('link', { name: 'Kanban' }).map(link => link.getAttribute('href'))).toEqual(['/project/p1/kanban', '/project/p1/kanban?board=b1']);
  fireEvent.change(screen.getByLabelText('Board name'), { target: { value: 'Ops' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create board' }));
  await waitFor(() => expect(api.createProjectBoard).toHaveBeenCalledWith('p1', { name: 'Ops', description: '' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archive board' }));
  await waitFor(() => expect(api.updateProjectBoard).toHaveBeenCalledWith('p1', 'b1', { revision: 3, archived: true }));
});
