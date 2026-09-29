import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';

const auth = { user: null, stopImpersonation: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }));

const { default: ImpersonationBanner } = await import('../components/ImpersonationBanner');

function view(minutesFromNow) {
  return {
    sessionId: 's-1',
    actor: { id: 'admin-1', name: 'Avery Admin' },
    subject: { id: 'team-1', name: 'Terry Team', role: 'TEAM' },
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + minutesFromNow * 60_000).toISOString(),
    readOnly: true,
  };
}

describe('ImpersonationBanner (#416)', () => {
  beforeEach(() => {
    auth.stopImpersonation = vi.fn().mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    auth.user = null;
  });

  it('renders nothing outside a support view', () => {
    auth.user = { id: 'admin-1', role: 'ADMIN' };
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the viewed person, says read only, shows the time left and stops on request', async () => {
    auth.user = { id: 'team-1', role: 'TEAM', impersonation: view(30) };
    render(<ImpersonationBanner />);
    const region = screen.getByRole('region', { name: 'Support view' });
    expect(region).toHaveTextContent('Viewing as Terry Team');
    expect(region).toHaveTextContent('read only');
    expect(region).toHaveTextContent('ends in 30 min');

    const stop = screen.getByRole('button', { name: 'Stop viewing as Terry Team' });
    expect(stop).toHaveTextContent('Stop');
    fireEvent.click(stop);
    await waitFor(() => expect(auth.stopImpersonation).toHaveBeenCalledTimes(1));
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    expect(auth.stopImpersonation).toHaveBeenCalledTimes(1);
  });

  it('counts down and ends the view once the window is over', async () => {
    vi.useFakeTimers();
    auth.user = { id: 'team-1', role: 'TEAM', impersonation: view(0.2) };
    render(<ImpersonationBanner />);
    expect(screen.getByRole('region', { name: 'Support view' })).toHaveTextContent('ends in 1 min');
    expect(auth.stopImpersonation).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(15_000); });
    expect(auth.stopImpersonation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('region', { name: 'Support view' })).toHaveTextContent('ending now');
    await act(async () => { vi.advanceTimersByTime(30_000); });
    expect(auth.stopImpersonation).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations', async () => {
    auth.user = { id: 'team-1', role: 'TEAM', impersonation: view(12) };
    const { container } = render(<main><ImpersonationBanner /></main>);
    const results = await axe.run(container, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
