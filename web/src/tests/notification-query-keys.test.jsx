import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Notifications from '../pages/Notifications';
import { api } from '../lib/api';
import {
  dropdownNotificationsKey,
  invalidateNotifications,
  pageNotificationsKey,
  unreadNotificationsKey,
} from '../lib/notificationKeys';

vi.mock('../lib/api', () => ({
  api: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}));

const note = (i) => ({ id: `n${i}`, message: `Notification ${i}`, read: false, createdAt: '2026-09-30T12:00:00.000Z' });

afterEach(() => vi.clearAllMocks());

describe('notification query keys', () => {
  it('gives the dropdown and the page distinct keys', () => {
    expect(dropdownNotificationsKey).not.toEqual(pageNotificationsKey);
    expect(dropdownNotificationsKey[0]).toBe('notifications');
    expect(pageNotificationsKey[0]).toBe('notifications');
  });

  it('invalidates both lists and the unread count', async () => {
    const queryClient = new QueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    queryClient.setQueryData(dropdownNotificationsKey, []);
    queryClient.setQueryData(pageNotificationsKey, []);
    queryClient.setQueryData(unreadNotificationsKey, { count: 1 });
    await invalidateNotifications(queryClient);
    expect(queryClient.getQueryState(dropdownNotificationsKey).isInvalidated).toBe(true);
    expect(queryClient.getQueryState(pageNotificationsKey).isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unreadNotificationsKey).isInvalidated).toBe(true);
    expect(spy).toHaveBeenCalledWith({ queryKey: unreadNotificationsKey });
  });

  it('the page fetches its own 50, not the dropdown\'s cached 10, and refreshes the badge on read', async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    queryClient.setQueryData(dropdownNotificationsKey, Array.from({ length: 10 }, (_, i) => note(i)));
    queryClient.setQueryData(unreadNotificationsKey, { count: 30 });
    api.getNotifications.mockResolvedValue({ notifications: Array.from({ length: 30 }, (_, i) => note(i)) });
    api.markNotificationRead.mockResolvedValue({});

    render(<QueryClientProvider client={queryClient}><Notifications /></QueryClientProvider>);

    await screen.findByText('Notification 29');
    expect(api.getNotifications).toHaveBeenCalledWith({ limit: 50 });
    const buttons = screen.getAllByRole('button', { name: 'Mark notification as read' });
    expect(buttons).toHaveLength(30);

    const [markRead] = buttons;
    await user.click(markRead);
    await waitFor(() => expect(queryClient.getQueryState(unreadNotificationsKey).isInvalidated).toBe(true));
  });
});
