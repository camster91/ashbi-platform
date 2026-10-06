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

const { default: LiveTimer, TIMER_PICKER_CLASS, describeElapsed } = await import('../components/LiveTimer');
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

  it('pins the picker to the viewport on phones and keeps a 44px header tap target', async () => {
    renderTimer();
    const toggle = screen.getByRole('button', { name: 'Timer' });
    expect(toggle.className).toMatch(/\bmin-h-11\b/);
    expect(toggle.className).toMatch(/\bmin-w-11\b/);
    fireEvent.click(toggle);
    const picker = await screen.findByTestId('live-timer-picker');
    expect(picker.className).toBe(TIMER_PICKER_CLASS);
    const classes = TIMER_PICKER_CLASS.split(/\s+/);
    // Base (phone) layout: fixed to the viewport with a 16px gutter on both
    // sides, so it can never start at a negative x on a 375px screen.
    expect(classes).toEqual(expect.arrayContaining(['fixed', 'inset-x-4']));
    expect(classes).not.toContain('right-0');
    expect(classes).not.toContain('w-64');
    // From sm up it is 256px wide, placed under the button from its rect.
    expect(classes).toEqual(expect.arrayContaining(['sm:w-64', 'sm:left-auto']));
    // Portalled to <body>, so `fixed` really is relative to the viewport (the
    // header's backdrop-filter would otherwise contain it).
    expect(picker.parentElement).toBe(document.body);
    // Focus moves into the picker, and Escape returns it to the toggle.
    await waitFor(() => expect(screen.getByLabelText('Project')).toHaveFocus());
    fireEvent.keyDown(screen.getByLabelText('Project'), { key: 'Escape' });
    expect(screen.queryByTestId('live-timer-picker')).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it('names the running time on the Stop button in plain words', async () => {
    localStorage.setItem('ashbi-live-timer', JSON.stringify({ isRunning: true, sessionId: 's1', startTime: Date.now() - (65 * 60 + 5) * 1000, elapsed: 0, description: '' }));
    renderTimer();
    expect(screen.getByRole('button', { name: 'Stop timer, 1 hour 5 minutes running' })).toBeInTheDocument();
    expect(describeElapsed(30)).toBe('less than a minute');
    expect(describeElapsed(120)).toBe('2 minutes');
    expect(describeElapsed(7200)).toBe('2 hours');
  });
});
