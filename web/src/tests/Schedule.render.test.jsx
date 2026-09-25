import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const upcomingEvent = {
  id: 'evt-1',
  title: 'Client kickoff',
  type: 'MEETING',
  startTime: '2030-01-07T15:00:00.000Z',
  endTime: '2030-01-07T16:00:00.000Z',
  allDay: false,
  googleEventId: null,
};

vi.mock('../lib/api', () => ({
  api: {
    getCalendarEvents: vi.fn(async () => []),
    getUpcomingEvents: vi.fn(async () => [upcomingEvent]),
    getProjects: vi.fn(async () => ({ projects: [] })),
    getTeam: vi.fn(async () => []),
    createCalendarEvent: vi.fn(),
    updateCalendarEvent: vi.fn(),
    deleteCalendarEvent: vi.fn(),
    rsvpCalendarEvent: vi.fn(),
    syncGoogleCalendarEvent: vi.fn(),
  },
}));

const { default: Schedule } = await import('../pages/Schedule');

function renderSchedule() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Schedule page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the upcoming sidebar without crashing', async () => {
    renderSchedule();
    expect(await screen.findByText('Upcoming')).toBeInTheDocument();
    expect(await screen.findByText('Client kickoff')).toBeInTheDocument();
    // The Google Calendar sync controls belong to an event's details, not the sidebar.
    expect(screen.queryByText('Sync to Google Calendar')).not.toBeInTheDocument();
  });

  it('offers Google Calendar sync from the event details', async () => {
    renderSchedule();
    fireEvent.click(await screen.findByText('Client kickoff'));
    expect(await screen.findByRole('button', { name: /Sync to Google Calendar/ })).toBeInTheDocument();
  });
});
