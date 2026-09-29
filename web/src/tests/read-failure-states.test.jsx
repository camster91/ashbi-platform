import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Failed background reads no longer raise a global toast (lib/apiErrorToast),
// so every component that reads data must say so itself when the read fails.
const failure = Object.assign(new Error('Server error'), { status: 500 });

vi.mock('../lib/api', () => ({
  api: {
    getCalendarEvents: vi.fn(),
    getTasks: vi.fn(),
    getProjectContext: vi.fn(),
    getClients: vi.fn(),
    getTeam: vi.fn(),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', role: 'ADMIN' } }) }));

import { api } from '../lib/api';
import Calendar from '../components/Calendar';
import KanbanBoard from '../components/KanbanBoard';
import ProjectContext from '../components/project/ProjectContext';
import CreateProjectModal from '../components/CreateProjectModal';

function renderWithQuery(ui) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}>{ui}</QueryClientProvider></MemoryRouter>);
}

describe('failed reads show an inline error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const fn of Object.values(api)) fn.mockRejectedValue(failure);
  });

  it('calendar', async () => {
    renderWithQuery(<Calendar projectId="p1" />);
    expect(await screen.findByText('Calendar events could not be loaded')).toBeInTheDocument();
  });

  it('kanban board', async () => {
    renderWithQuery(<KanbanBoard projectId="p1" />);
    expect(await screen.findByText('Tasks could not be loaded')).toBeInTheDocument();
  });

  it('project context', async () => {
    renderWithQuery(<ProjectContext projectId="p1" />);
    expect(await screen.findByText('Project context could not be loaded')).toBeInTheDocument();
  });

  it('create project pickers', async () => {
    renderWithQuery(<CreateProjectModal isOpen onClose={() => {}} />);
    expect(await screen.findByText(/could not be loaded, so the list below may be empty/)).toBeInTheDocument();
  });
});
