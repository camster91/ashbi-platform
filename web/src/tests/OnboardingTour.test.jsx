import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import OnboardingTour from '../components/OnboardingTour';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getOnboardingProgress: vi.fn(),
    startOnboarding: vi.fn(),
    skipOnboardingTask: vi.fn(),
    skipOnboarding: vi.fn(),
  },
}));

const eligible = {
  supported: true,
  role: 'ADMIN',
  state: 'eligible',
  startedAt: null,
  completedCount: 0,
  totalCount: 3,
  tasks: [
    { id: 'add-client', title: 'Add your first client', description: 'Create a client.', href: '/clients', completed: false, skipped: false },
    { id: 'create-project', title: 'Create a client project', description: 'Create a project.', href: '/projects', completed: false, skipped: false },
    { id: 'create-proposal', title: 'Create a proposal', description: 'Create a proposal.', href: '/proposals', completed: false, skipped: false },
  ],
};

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderTour() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <OnboardingTour />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('role-aware onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getOnboardingProgress.mockResolvedValue(eligible);
  });

  it('starts explicitly and does not mark work complete from navigation', async () => {
    api.startOnboarding.mockResolvedValue({ ...eligible, state: 'in_progress', startedAt: '2026-08-09T12:00:00.000Z' });
    renderTour();

    expect(await screen.findByRole('dialog', { name: 'Get started with Ashbi' }, { timeout: 2000 })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start checklist' }));
    expect(await screen.findByRole('dialog', { name: 'Your getting-started checklist' })).toBeInTheDocument();
    expect(api.startOnboarding).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByRole('button', { name: /Open task/ })[0]);
    expect(screen.getByTestId('location')).toHaveTextContent('/clients');
    expect(api.skipOnboardingTask).not.toHaveBeenCalled();
  });

  it('records an explicit task skip and exposes save failure without losing the checklist', async () => {
    api.getOnboardingProgress.mockResolvedValue({ ...eligible, state: 'in_progress', startedAt: '2026-08-09T12:00:00.000Z' });
    api.skipOnboardingTask
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        ...eligible,
        state: 'in_progress',
        startedAt: '2026-08-09T12:00:00.000Z',
        completedCount: 1,
        tasks: eligible.tasks.map(task => task.id === 'add-client' ? { ...task, skipped: true } : task),
      });
    renderTour();

    await screen.findByRole('dialog', { name: 'Your getting-started checklist' }, { timeout: 2000 });
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip this task' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('heading', { name: 'Add your first client' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Skip this task' })[0]);
    await waitFor(() => expect(screen.getByText('Skipped')).toBeInTheDocument());
  });

  it('renders nothing for explicitly deferred client onboarding', async () => {
    api.getOnboardingProgress.mockResolvedValue({
      supported: false,
      role: 'CLIENT',
      state: 'deferred',
      reason: 'Deferred to issue #286.',
      tasks: [],
    });
    renderTour();
    await waitFor(() => expect(api.getOnboardingProgress).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /getting started/i })).not.toBeInTheDocument();
  });
});
