import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import NotificationsDropdown from '../components/NotificationsDropdown';
import { dropdownNotificationsKey, unreadNotificationsKey } from '../lib/notificationKeys';

vi.mock('../lib/api', () => ({ api: {} }));
vi.mock('../hooks/useSocket', () => ({ default: () => ({ socket: null }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ info: vi.fn() }) }));

function renderDropdown(count, notifications = []) {
  const cache = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  cache.setQueryData(dropdownNotificationsKey, notifications);
  cache.setQueryData(unreadNotificationsKey, { count });
  return render(<QueryClientProvider client={cache}><MemoryRouter><NotificationsDropdown /></MemoryRouter></QueryClientProvider>);
}

describe('Notification control names', () => {
  it.each([
    [0, 'Notifications', ''],
    [2, 'Notifications, 2 unread', '2'],
    [12, 'Notifications, 9+ unread, 12 in total', '9+'],
  ])('names count %i with the visible badge outside parentheticals', (count, name, badge) => {
    renderDropdown(count);
    const button = screen.getByRole('button', { name });
    expect(button.textContent).toBe(badge);
    expect(button).not.toHaveAttribute('aria-label', expect.stringContaining('('));
    if (badge) expect(button.getAttribute('aria-label')).toContain(badge);
  });

  it('includes the complete visible bulk-action label in its accessible name', () => {
    renderDropdown(2, [{ id: 'n', title: 'Client replied', message: 'Please review', type: 'CLIENT_REPLIED', read: false, createdAt: '2026-10-17T12:00:00Z' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Notifications, 2 unread' }));
    expect(screen.getByRole('button', { name: 'Mark all read' })).toHaveTextContent('Mark all read');
  });
});
