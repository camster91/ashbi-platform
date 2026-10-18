import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { user: { id: 'u-cam', name: 'Cameron Ashley', role: 'ADMIN' } };
const DAY = 86400000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

const team = [
  { id: 'u-cam', name: 'Cameron Ashley', role: 'ADMIN', isActive: true },
  { id: 'u-bia', name: 'Bianca Ross', role: 'TEAM', isActive: true },
  { id: 'u-old', name: 'Former Person', role: 'TEAM', isActive: false },
];

const baseProjects = [
  { id: 'p-plan', name: 'Booking site', status: 'STARTING_UP', startDate: '2030-10-28T00:00:00.000Z', defaultOwnerId: 'u-cam', client: { id: 'c-lake', name: 'Lakeside Yoga' }, updatedAt: iso(-1), _count: { tasks: 0 } },
  { id: 'p-harbour', name: 'Website rebuild', status: 'DESIGN_DEV', endDate: iso(3), defaultOwnerId: 'u-bia', client: { id: 'c-harbour', name: 'Harbour Hotel' }, updatedAt: iso(-1), completedTaskCount: 14, _count: { tasks: 20 }, budget: 12000 },
  { id: 'p-late', name: 'Holiday landing page', status: 'ACTIVE', endDate: iso(-2), client: { id: 'c-north', name: 'Northwind Coffee' }, updatedAt: iso(-1), completedTaskCount: 6, _count: { tasks: 10 } },
  { id: 'p-review', name: 'New services pages', status: 'FINALIZING', health: 'AT_RISK', client: { id: 'c-maple', name: 'Maple Dental' }, updatedAt: iso(-2), _count: { tasks: 0 } },
  { id: 'p-live', name: '37-page site', status: 'LAUNCHED', completedAt: '2030-10-12T12:00:00.000Z', client: { id: 'c-joe', name: "Joe's Heating" }, updatedAt: iso(-5), _count: { tasks: 0 } },
];

vi.mock('../lib/api', () => ({
  api: {
    getProjects: vi.fn(),
    getTeam: vi.fn(),
    updateProject: vi.fn(async () => ({})),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../components/CreateProjectModal', () => ({
  default: ({ isOpen, preselectedClientId, preselectedPortfolio }) => (isOpen
    ? <div role="dialog" aria-label="Create New Project">client={preselectedClientId || '-'} portfolio={preselectedPortfolio || '-'}</div>
    : null),
}));

const { default: Projects } = await import('../pages/Projects');
const { api } = await import('../lib/api');

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderProjects(path = '/projects') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes><Route path="/projects" element={<Projects />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = (name) => screen.getByRole('heading', { name }).closest('article');

describe('Projects page redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'u-cam', name: 'Cameron Ashley', role: 'ADMIN' };
    api.getProjects.mockResolvedValue({ projects: baseProjects, total: baseProjects.length });
    api.getTeam.mockResolvedValue(team);
  });

  it('shows the mockup header, view toggle and summary chips', async () => {
    renderProjects();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Projects in motion');
    expect(screen.getByText('Work')).toHaveClass('text-eyebrow');
    const views = screen.getByRole('group', { name: 'View' });
    expect(within(views).getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(views).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'false');

    const summary = screen.getByRole('group', { name: 'Project summary' });
    expect(summary).toHaveTextContent('4 active · 5 in total');
    expect(summary).toHaveTextContent('1 overdue');
    expect(summary).toHaveTextContent('1 due this week');
    expect(summary).toHaveTextContent('1 in client review');
    expect(within(summary).getByRole('link', { name: 'Project templates' })).toHaveAttribute('href', '/project-templates');
  });

  it('puts each project in its stage column with the stage-specific detail', async () => {
    renderProjects();
    await screen.findByText('Website rebuild');
    expect(within(screen.getByRole('region', { name: 'Planning' })).getByText('Booking site')).toBeInTheDocument();
    expect(within(card('Booking site')).getByText('Starts Oct 28, 2030')).toBeInTheDocument();
    expect(within(card('Booking site')).getByRole('img', { name: 'Owner Cameron Ashley' })).toHaveTextContent('CA');

    const harbour = card('Website rebuild');
    expect(screen.getByRole('region', { name: 'In progress' })).toContainElement(harbour);
    expect(within(harbour).getByText('14 / 20 tasks')).toBeInTheDocument();
    expect(within(harbour).getByRole('progressbar', { name: 'Website rebuild tasks' })).toHaveAttribute('aria-valuenow', '14');
    expect(within(harbour).getByRole('img', { name: 'Owner Bianca Ross' })).toHaveTextContent('BR');
    expect(within(harbour).getByRole('link', { name: /Website rebuild/ })).toHaveAttribute('href', '/project/p-harbour');
    expect(within(harbour).getByRole('link', { name: 'Task views' })).toHaveAttribute('href', '/project/p-harbour/views');

    expect(within(card('Holiday landing page')).getByText('· overdue')).toBeInTheDocument();
    expect(within(card('New services pages')).getByText(/In client review · updated/)).toBeInTheDocument();
    expect(within(card('37-page site')).getByText('Live Oct 12, 2030')).toBeInTheDocument();
  });

  it('keeps only the latest launched projects open behind "Show older"', async () => {
    const launched = Array.from({ length: 7 }, (_, index) => ({
      id: `done-${index}`, name: `Launch ${index}`, status: 'LAUNCHED', completedAt: iso(-index - 1), updatedAt: iso(-index - 1), _count: { tasks: 0 },
    }));
    api.getProjects.mockResolvedValue({ projects: launched, total: launched.length });
    renderProjects();
    await screen.findByText('Launch 0');
    expect(screen.queryByText('Launch 6')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 older' }));
    expect(screen.getByText('Launch 6')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('switches to List and Calendar views and keeps the view in the URL', async () => {
    renderProjects();
    await screen.findByText('Website rebuild');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?view=list');
    const table = screen.getByRole('table', { name: 'Projects' });
    const row = within(table).getByRole('link', { name: 'Website rebuild' }).closest('tr');
    expect(within(row).getByText('Bianca Ross')).toBeInTheDocument();
    expect(within(row).getByText('14 / 20')).toBeInTheDocument();
    expect(within(row).getByLabelText('Portfolio for Website rebuild')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?view=calendar');
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument();
    const undated = screen.getByRole('region', { name: /No due date/ });
    expect(within(undated).getByRole('link', { name: /Booking site/ })).toHaveAttribute('href', '/project/p-plan');

    fireEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(screen.getByTestId('location').textContent).toBe('/projects');
  });

  it('opens a deep-linked list view', async () => {
    renderProjects('/projects?view=list');
    expect(await screen.findByRole('table', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('filters by owner in the URL, including mine and no owner, from active team members', async () => {
    renderProjects();
    await screen.findByText('Website rebuild');
    const ownerSelect = screen.getByLabelText('Owner');
    const options = within(ownerSelect).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Everyone', 'Mine', 'Bianca Ross', 'No owner']);

    fireEvent.change(ownerSelect, { target: { value: 'me' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?owner=me');
    expect(screen.getByText('Booking site')).toBeInTheDocument();
    expect(screen.queryByText('Website rebuild')).not.toBeInTheDocument();

    fireEvent.change(ownerSelect, { target: { value: 'none' } });
    expect(screen.getByText('Holiday landing page')).toBeInTheDocument();
    expect(screen.queryByText('Booking site')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Project summary' })).toHaveTextContent('2 active · 3 in total');
  });

  it('opens the create dialog through ?create=true and keeps a client and portfolio deep link', async () => {
    renderProjects('/projects?portfolio=FREELANCE');
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/projects?portfolio=FREELANCE&create=true');
    expect(screen.getByRole('dialog', { name: 'Create New Project' })).toHaveTextContent('client=- portfolio=FREELANCE');
  });

  it('passes the client from a client page link to the create dialog', async () => {
    renderProjects('/projects?create=true&clientId=c-maple');
    expect(await screen.findByRole('dialog', { name: 'Create New Project' })).toHaveTextContent('client=c-maple');
  });

  it('gives admins a final invoice link on launched work', async () => {
    renderProjects();
    await screen.findByText('37-page site');
    expect(within(card('37-page site')).getByRole('link', { name: 'Final invoice for 37-page site' }))
      .toHaveAttribute('href', '/invoices?create=true&clientId=c-joe');
  });

  it('shows team members the work but no invoices or money', async () => {
    authState.user = { id: 'u-bia', name: 'Bianca Ross', role: 'TEAM' };
    const { container } = renderProjects();
    await screen.findByText('Website rebuild');
    expect(screen.queryByRole('link', { name: /Final invoice/ })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|12,000|12000|budget/i);
    expect(screen.getByRole('button', { name: 'New project' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Owner')).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['Everyone', 'Mine', 'Cameron Ashley', 'No owner']);
  });

  it('still shows the projects when the team list cannot load', async () => {
    api.getTeam.mockRejectedValue(new Error('team down'));
    renderProjects();
    expect(await screen.findByText('Website rebuild')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Owner/ })).not.toBeInTheDocument();
  });

  it('shows a first-project empty state without a second New project button', async () => {
    api.getProjects.mockResolvedValue({ projects: [], total: 0 });
    renderProjects();
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /new project/i })).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Project status board' })).not.toBeInTheDocument();
  });

  it('offers to clear filters when nothing matches them', async () => {
    renderProjects('/projects?owner=u-nobody&view=list');
    expect(await screen.findByRole('heading', { name: 'No projects match these filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all projects' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/projects?view=list'));
    expect(await screen.findByRole('table', { name: 'Projects' })).toBeInTheDocument();
  });

  it('shows the board skeleton while loading and a retryable error on failure', async () => {
    api.getProjects.mockReturnValue(new Promise(() => {}));
    const { unmount } = renderProjects();
    expect(screen.getByRole('status', { name: 'Loading projects' })).toBeInTheDocument();
    unmount();

    api.getProjects.mockRejectedValueOnce(new Error('Server error'));
    renderProjects();
    expect(await screen.findByText('Projects could not be loaded')).toBeInTheDocument();
    api.getProjects.mockResolvedValue({ projects: baseProjects, total: baseProjects.length });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Website rebuild')).toBeInTheDocument();
  });
});
