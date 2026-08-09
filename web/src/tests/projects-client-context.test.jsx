import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Projects from '../pages/Projects';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getProjects: vi.fn(),
    getClients: vi.fn(),
    getTeam: vi.fn(),
    createProject: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{location.pathname}{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
      <button type="button" onClick={() => navigate(1)}>History forward</button>
    </>
  );
}

function renderProjects(initialEntries) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries} initialIndex={initialEntries.length - 1}>
        <LocationProbe />
        <Routes>
          <Route path="/projects" element={<Projects />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Projects client-origin creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getProjects.mockResolvedValue({ projects: [] });
    api.getClients.mockResolvedValue({
      clients: [
        { id: 'client-one', name: 'Client One' },
        { id: 'client-two', name: 'Client Two' },
      ],
    });
    api.getTeam.mockResolvedValue({ team: [] });
    api.createProject.mockResolvedValue({ id: 'project-one' });
  });

  it('preselects the client carried by the URL and preserves it in the request', async () => {
    renderProjects(['/projects?create=true&clientId=client-two']);

    const clientSelect = await screen.findByRole('combobox', { name: /client/i });
    expect(clientSelect).toHaveValue('client-two');

    fireEvent.change(screen.getByRole('textbox', { name: /project name/i }), {
      target: { value: 'Context project' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));

    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Context project',
      clientId: 'client-two',
    })));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects'));
  });

  it('fails safely when the URL names an unavailable client', async () => {
    renderProjects(['/projects?create=true&clientId=missing-client']);

    expect(await screen.findByText(/selected client is unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /client/i })).toHaveValue('');
    expect(api.createProject).not.toHaveBeenCalled();
  });

  it('cleans stale query state on cancel and follows browser history', async () => {
    renderProjects(['/projects', '/projects?create=true&clientId=client-one']);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent('/projects');

    fireEvent.click(screen.getByRole('button', { name: 'History back' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects'));

    fireEvent.click(screen.getByRole('button', { name: 'History forward' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/projects'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
