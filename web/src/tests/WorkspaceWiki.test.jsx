import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import WorkspaceWiki from '../pages/WorkspaceWiki';
import WorkspaceWikiPage from '../pages/WorkspaceWikiPage';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: { getWorkspacePages: vi.fn(), getWorkspacePage: vi.fn(), createWorkspacePage: vi.fn(), updateWorkspacePage: vi.fn(), getWorkspacePageAccess: vi.fn(), getWorkspacePageAccessOptions: vi.fn(), saveWorkspacePageAccess: vi.fn() } }));
function mount(url) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><MemoryRouter initialEntries={[url]}><Routes><Route path="/wiki" element={<WorkspaceWiki />} /><Route path="/wiki/:pageId" element={<WorkspaceWikiPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  return cache;
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getWorkspacePages.mockResolvedValue({ items: [], nextCursor: null });
  api.getWorkspacePageAccess.mockResolvedValue({ revision: 0, mode: 'TEAM', members: [] });
  api.getWorkspacePageAccessOptions.mockResolvedValue({ items: [], nextCursor: null });
});
it('creates knowledge without a client/project and navigates to the returned canonical page', async () => {
  api.createWorkspacePage.mockResolvedValue({ id: 'page' });
  api.getWorkspacePage.mockResolvedValue({ id: 'page', title: 'Ashbi handbook', content: '# Welcome', revision: 0, parentId: null, permissions: { canEdit: true, canManage: true } });
  mount('/wiki');
  fireEvent.change(screen.getByLabelText('Page title'), { target: { value: 'Ashbi handbook' } });
  fireEvent.change(screen.getByLabelText('Page content'), { target: { value: '# Welcome' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create page' }));
  await screen.findByRole('heading', { name: 'Ashbi handbook' });
  expect(api.createWorkspacePage).toHaveBeenCalledWith({ title: 'Ashbi handbook', content: '# Welcome', parentId: null, accessMode: 'TEAM' });
});
it('retains a wiki draft and observed revision through background refetch and failed reload', async () => {
  let page = { id: 'page', title: 'Handbook', content: 'Original', revision: 2, parentId: null, permissions: { canEdit: true, canManage: true } };
  api.getWorkspacePage.mockImplementation(async () => page);
  api.updateWorkspacePage.mockRejectedValue(new Error('Knowledge page changed'));
  const cache = mount('/wiki/page');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit page' }));
  fireEvent.change(screen.getByLabelText('Page content'), { target: { value: 'My draft' } });
  page = { ...page, content: 'Team edit', revision: 3 };
  await cache.invalidateQueries({ queryKey: ['workspacePage', 'page'] });
  fireEvent.click(screen.getByRole('button', { name: 'Save page' }));
  await screen.findByText(/Knowledge page changed/);
  expect(api.updateWorkspacePage).toHaveBeenCalledWith('page', expect.objectContaining({ revision: 2, content: 'My draft' }));
  api.getWorkspacePage.mockRejectedValueOnce(new Error('Offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
  await screen.findByText('The document could not be reloaded. Your draft is still retained.');
  expect(screen.getByLabelText('Page content')).toHaveValue('My draft');
  fireEvent.click(screen.getByRole('button', { name: 'Reload document and discard draft' }));
  await waitFor(() => expect(screen.getByLabelText('Page content')).toHaveValue('Team edit'));
});
it('resets draft identity when following another knowledge page link', async () => {
  api.getWorkspacePage.mockImplementation(async id => ({ id, title: id, content: `Content ${id}`, revision: 0, parentId: null, permissions: { canEdit: true, canManage: true } }));
  api.getWorkspacePages.mockImplementation(async input => ({ items: input.parentId === 'first' ? [{ id: 'second', title: 'Second page' }] : [], nextCursor: null }));
  mount('/wiki/first');
  fireEvent.click(await screen.findByRole('button', { name: 'Edit page' }));
  fireEvent.change(screen.getByLabelText('Page content'), { target: { value: 'First page draft' } });
  fireEvent.click(await screen.findByRole('link', { name: 'Second page' }));
  await screen.findByRole('heading', { name: 'second' });
  expect(screen.queryByLabelText('Page content')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit page' }));
  expect(screen.getByLabelText('Page content')).toHaveValue('Content second');
});

it('shows a read-only page without edit, hierarchy, archive or audience controls', async () => {
  api.getWorkspacePage.mockResolvedValue({ id: 'page', title: 'Read-only handbook', content: 'Visible content', revision: 1, parentId: null, accessMode: 'RESTRICTED', permissions: { canRead: true, canEdit: false, canManage: false } });
  mount('/wiki/page');
  await screen.findByRole('heading', { name: 'Read-only handbook' });
  expect(screen.getByText('This page is read only.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Edit page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Archive page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Create nested page' })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Knowledge page access' })).not.toBeInTheDocument();
});
