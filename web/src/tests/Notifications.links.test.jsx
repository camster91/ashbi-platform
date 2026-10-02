import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Notifications from '../pages/Notifications';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getNotifications: vi.fn(),
    markNotificationRead: vi.fn(),
    markAllNotificationsRead: vi.fn(),
  },
}));

afterEach(() => vi.clearAllMocks());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/notifications']}>
        <Routes>
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/thread/:id" element={<p>Thread page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Notifications page items', () => {
  it('shows each title with its message and links to the target when there is one', async () => {
    const user = userEvent.setup();
    api.getNotifications.mockResolvedValue({
      notifications: [
        {
          id: 'n1', type: 'CLIENT_REPLIED', title: 'Client replied', message: 'Dana answered your question',
          data: { threadId: 't-9' }, read: false, createdAt: '2026-09-30T12:00:00.000Z',
        },
        {
          id: 'n2', type: 'SOMETHING_ELSE', title: 'Weekly digest ready', message: 'Your digest is ready',
          data: null, read: true, createdAt: '2026-09-29T12:00:00.000Z',
        },
      ],
    });
    api.markNotificationRead.mockResolvedValue({});
    renderPage();

    const link = await screen.findByRole('link', { name: /Client replied/ });
    expect(link).toHaveAttribute('href', '/thread/t-9');
    expect(screen.getByText('Dana answered your question')).toBeInTheDocument();

    // No known target: the title still shows, but it is not a link.
    expect(screen.getByText('Weekly digest ready')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Weekly digest ready/ })).toBeNull();

    await user.click(link);
    expect(await screen.findByText('Thread page')).toBeInTheDocument();
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith('n1'));
  });
});
