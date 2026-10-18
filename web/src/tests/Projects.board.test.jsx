import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const projects = [
  { id: 'p1', name: 'Northwind Brand Refresh', status: 'ACTIVE', health: 'ON_TRACK', endDate: '2030-11-06T12:00:00.000Z', updatedAt: '2030-09-01T12:00:00.000Z', _count: { tasks: 0 } },
  { id: 'p2', name: 'Maple Website', status: 'COMPLETED', updatedAt: '2030-08-15T12:00:00.000Z', _count: { tasks: 0 } },
  { id: 'p3', name: 'Imported legacy project', status: 'ARCHIVED_IN_BONSAI', updatedAt: '2030-08-15T12:00:00.000Z', _count: { tasks: 0 } },
];

vi.mock('../lib/api', () => ({ api: {
  getProjects: vi.fn(async ({ portfolio } = {}) => ({ projects: portfolio ? projects.filter(p => p.portfolio === portfolio) : projects })),
  updateProject: vi.fn(async () => ({})),
  getTeam: vi.fn(async () => []),
} }));
vi.mock('../components/CreateProjectModal', () => ({ default: () => null }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));

const { default: Projects } = await import('../pages/Projects');
const { api } = await import('../lib/api');

function renderProjects() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Projects />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Projects board', () => {
  it('filters by portfolio through the API and keeps an All work view', async () => {
    renderProjects();
    await screen.findByText('Northwind Brand Refresh');
    fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: 'FREELANCE' } });
    await waitFor(() => expect(api.getProjects).toHaveBeenCalledWith({ limit: 200, offset: 0, portfolio: 'FREELANCE' }));
    await waitFor(() => expect(screen.queryByText('Northwind Brand Refresh')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Work portfolio'), { target: { value: '' } });
    expect(await screen.findByText('Northwind Brand Refresh')).toBeInTheDocument();
  });

  it('saves an existing project classification and displays write failure', async () => {
    api.updateProject.mockRejectedValueOnce(new Error('Could not save'));
    renderProjects();
    fireEvent.change(await screen.findByLabelText('Portfolio for Northwind Brand Refresh'), { target: { value: 'ASHBI_DESIGN' } });
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledWith('p1', { portfolio: 'ASHBI_DESIGN' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save');
  });

  it('loads later pages so the portfolio board does not silently omit projects', async () => {
    api.getProjects.mockResolvedValueOnce({ projects: [projects[0]], total: 2 });
    api.getProjects.mockResolvedValueOnce({ projects: [projects[1]], total: 2 });
    renderProjects();
    expect(await screen.findByText('Maple Website')).toBeInTheDocument();
    expect(api.getProjects).toHaveBeenCalledWith({ limit: 200, offset: 1 });
  });
  it('places every project in a column, with unknown statuses in a visible Other column', async () => {
    renderProjects();
    expect(await screen.findByText('Northwind Brand Refresh')).toBeInTheDocument();
    expect(screen.getByText('Maple Website')).toBeInTheDocument();
    const other = screen.getByRole('region', { name: 'Other' });
    expect(within(other).getByText('Imported legacy project')).toBeInTheDocument();
  });

  it('labels dates honestly: due date when set, otherwise last update', async () => {
    renderProjects();
    expect(await screen.findByText('Due Nov 6, 2030')).toBeInTheDocument();
    expect(screen.getAllByText('Updated Aug 15, 2030').length).toBeGreaterThan(0);
  });

  it('uses natural empty-state copy', async () => {
    renderProjects();
    expect(await screen.findByText('Nothing is waiting for review.')).toBeInTheDocument();
    expect(screen.queryByText(/currently in/)).not.toBeInTheDocument();
  });
});
