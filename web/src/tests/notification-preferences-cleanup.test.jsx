import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationPreferences } from '../pages/Settings';

const pushState = vi.hoisted(() => ({ current: {} }));

vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-a' } }) }));
vi.mock('../hooks/usePushNotifications', () => ({ usePushNotifications: () => pushState.current }));

const base = {
  permission: 'granted',
  status: 'subscribed',
  error: '',
  supported: true,
  offline: false,
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

describe('NotificationPreferences cleanup state', () => {
  it('reports disabled-with-incomplete-cleanup instead of enabled after a failed disable', () => {
    pushState.current = { ...base, subscribed: true, optedIn: false, status: 'error', error: 'Notifications could not be disabled. Try again.' };
    render(<NotificationPreferences />);

    expect(screen.getByText(/disabled for this account/i)).toBeInTheDocument();
    expect(screen.queryByText(/enabled for this account/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable notifications/i })).toBeInTheDocument();
  });

  it('reports enabled when the account opted in and is subscribed', () => {
    pushState.current = { ...base, subscribed: true, optedIn: true };
    render(<NotificationPreferences />);

    expect(screen.getByText(/enabled for this account and browser/i)).toBeInTheDocument();
  });
});
