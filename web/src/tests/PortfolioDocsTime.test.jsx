import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import Docs from '../pages/Docs';
import Timesheets from '../pages/Timesheets';
import { api } from '../lib/api';

vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'team', role: 'TEAM' } }) }));
vi.mock('../lib/api', () => ({ api: { getAllNotes: vi.fn(), getWeeklyTimesheet: vi.fn(), getRunningTimeSession: vi.fn(async () => null), getProjects: vi.fn(), getTeam: vi.fn(async () => []), getNoteTemplates: vi.fn(async () => []) } }));
function setup(component, url) {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[url]}>{component}</MemoryRouter></QueryClientProvider>);
}
beforeEach(() => vi.clearAllMocks());
it('includes the visible project, client and document count in the expansion name', async () => {
  api.getAllNotes.mockResolvedValue({ notes: [{ id: 'brief', title: 'Delivery brief', type: 'DOC', updatedAt: '2026-10-13', project: { id: 'p', name: 'Spring refresh', client: { name: 'Northwind' } } }], pagination: { page: 1, pages: 1 } });
  setup(<Docs />, '/docs');
  const toggle = (await screen.findByText('Spring refresh')).closest('button');
  expect(toggle).toHaveAccessibleName('Toggle project Spring refresh — Northwind 1');
  expect(toggle).toHaveTextContent('Spring refresh');
  expect(toggle).toHaveTextContent('Northwind');
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Delivery brief')).toBeInTheDocument();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('Delivery brief')).not.toBeInTheDocument();
});
it('loads later documents and resets pagination when switching portfolio', async () => {
  api.getAllNotes.mockImplementation(async ({ page, portfolio }) => ({
    notes: [{ id: `${portfolio}-${page}`, title: `${portfolio} brief ${page}`, type: 'DOC', updatedAt: '2026-10-13', project: { id: 'p', name: 'Project' } }],
    pagination: { page, pages: portfolio === 'FREELANCE' ? 2 : 1 },
  }));
  setup(<Docs />, '/docs?portfolio=FREELANCE');
  expect(await screen.findByText('FREELANCE brief 1')).toBeInTheDocument();
  expect(screen.getByLabelText('Work portfolio')).toHaveValue('FREELANCE');
  fireEvent.click(screen.getByRole('button', { name: 'Load more documents' }));
  expect(await screen.findByText('FREELANCE brief 2')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: 'ASHBI_DESIGN' } });
  expect(await screen.findByText('ASHBI_DESIGN brief 1')).toBeInTheDocument();
  expect(screen.queryByText('FREELANCE brief 2')).not.toBeInTheDocument();
  expect(api.getAllNotes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, portfolio: 'ASHBI_DESIGN', paginated: 'true' }));
});
it('restores the timesheet portfolio from the URL and refetches all work', async () => {
  api.getWeeklyTimesheet.mockResolvedValue({ timesheets: [] });
  setup(<Timesheets />, '/timesheets?portfolio=UNCLASSIFIED');
  await waitFor(() => expect(api.getWeeklyTimesheet).toHaveBeenCalledWith(expect.any(String), { portfolio: 'UNCLASSIFIED' }));
  fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: '' } });
  await waitFor(() => expect(api.getWeeklyTimesheet).toHaveBeenLastCalledWith(expect.any(String), {}));
});
it('keeps later canonical projects available in the filtered document creation picker', async () => {
  api.getAllNotes.mockResolvedValue({ notes: [], pagination: { page: 1, pages: 0 } });
  api.getProjects.mockImplementation(async ({ offset, limit }) => ({ projects: Array.from({ length: Math.min(limit, 101 - offset) }, (_, index) => ({ id: `p${offset + index + 1}`, name: `Project ${offset + index + 1}` })), total: 101, limit, offset }));
  setup(<Docs />, '/docs?portfolio=FREELANCE&create=true');
  await screen.findByRole('option', { name: 'Project 1 —' }, { timeout: 5000 });
  expect(screen.getByLabelText('Work portfolio')).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Load more projects' }));
  expect(await screen.findByRole('option', { name: 'Project 101 —' }, { timeout: 5000 })).toBeInTheDocument();
  expect(api.getProjects).toHaveBeenLastCalledWith({ portfolio: 'FREELANCE', offset: 100, limit: 100 });
});
