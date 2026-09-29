import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const projects = [
  { id: 'p1', name: 'Northwind Brand Refresh', status: 'ACTIVE', health: 'ON_TRACK', endDate: '2030-11-06T12:00:00.000Z', updatedAt: '2030-09-01T12:00:00.000Z', _count: { tasks: 0 } },
  { id: 'p2', name: 'Maple Website', status: 'COMPLETED', updatedAt: '2030-08-15T12:00:00.000Z', _count: { tasks: 0 } },
  { id: 'p3', name: 'Imported legacy project', status: 'ARCHIVED_IN_BONSAI', updatedAt: '2030-08-15T12:00:00.000Z', _count: { tasks: 0 } },
];

vi.mock('../lib/api', () => ({ api: { getProjects: vi.fn(async () => ({ projects })) } }));
vi.mock('../components/CreateProjectModal', () => ({ default: () => null }));

const { default: Projects } = await import('../pages/Projects');

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
  it('places every project in a column, with unknown statuses in a visible Other column', async () => {
    renderProjects();
    expect(await screen.findByText('Northwind Brand Refresh')).toBeInTheDocument();
    expect(screen.getByText('Maple Website')).toBeInTheDocument();
    const other = screen.getByRole('heading', { name: 'Other' }).closest('div').parentElement;
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
