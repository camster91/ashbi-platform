import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startTimeSession = vi.fn(async (data) => ({ id: 'session-1', startTime: new Date().toISOString(), ...data }));

vi.mock('../lib/api', () => ({
  api: {
    getRunningTimeSession: vi.fn(async () => null),
    getProjects: vi.fn(async () => ({
      projects: [
        { id: 'p-active', name: 'Website refresh', status: 'DESIGN_DEV' },
        { id: 'p-launched', name: 'Old launch', status: 'LAUNCHED' },
      ],
    })),
    startTimeSession: (data) => startTimeSession(data),
    stopTimeSession: vi.fn(),
  },
}));

const { default: LiveTimer } = await import('../components/LiveTimer');
const PROJECT_KEY = 'ashbi-live-timer-project';

function renderTimer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <LiveTimer />
    </QueryClientProvider>,
  );
}

describe('LiveTimer project picker', () => {
  beforeEach(() => { localStorage.clear(); startTimeSession.mockClear(); });
  afterEach(() => localStorage.clear());

  it('forgets a remembered project that is no longer selectable', async () => {
    localStorage.setItem(PROJECT_KEY, 'p-launched');
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: /timer/i }));
    await screen.findByRole('option', { name: 'Website refresh' });
    await waitFor(() => expect(localStorage.getItem(PROJECT_KEY)).toBeNull());
    expect(screen.getByLabelText('Project')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a project to start the timer.');
    expect(startTimeSession).not.toHaveBeenCalled();
  });

  it('keeps a remembered project that is still selectable and starts with it', async () => {
    localStorage.setItem(PROJECT_KEY, 'p-active');
    renderTimer();
    fireEvent.click(screen.getByRole('button', { name: /timer/i }));
    await screen.findByRole('option', { name: 'Website refresh' });
    expect(screen.getByLabelText('Project')).toHaveValue('p-active');
    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));
    await waitFor(() => expect(startTimeSession).toHaveBeenCalledWith({ projectId: 'p-active', description: undefined }));
    expect(localStorage.getItem(PROJECT_KEY)).toBe('p-active');
  });
});
