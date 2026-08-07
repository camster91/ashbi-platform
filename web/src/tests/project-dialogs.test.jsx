import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Calendar from '../components/Calendar';
import Milestones from '../components/Milestones';
import Notes from '../components/Notes';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: {
    getNotes: vi.fn(),
    createNote: vi.fn(),
    getMilestones: vi.fn(),
    createMilestone: vi.fn(),
    getCalendarEvents: vi.fn(),
    createCalendarEvent: vi.fn(),
  },
}));

function renderWithQuery(ui) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => vi.clearAllMocks());

describe('project dialog journeys', () => {
  it('creates a note and closes after success', async () => {
    const user = userEvent.setup();
    api.getNotes.mockResolvedValue([]);
    api.createNote.mockResolvedValue({ id: 'note-1' });
    renderWithQuery(<Notes projectId="project-1" />);

    const trigger = await screen.findByRole('button', { name: /new note/i });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Create Note' });
    expect(dialog).toBeVisible();
    await user.type(within(dialog).getAllByRole('textbox')[0], 'Launch notes');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.createNote).toHaveBeenCalledWith('project-1', expect.objectContaining({ title: 'Launch notes' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('opens and cancels the milestone editor', async () => {
    const user = userEvent.setup();
    api.getMilestones.mockResolvedValue([]);
    renderWithQuery(<Milestones projectId="project-1" />);

    const trigger = await screen.findByRole('button', { name: /add milestone/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Create Milestone' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens the calendar create and event-detail dialogs', async () => {
    const user = userEvent.setup();
    const startTime = new Date();
    startTime.setHours(10, 0, 0, 0);
    api.getCalendarEvents.mockResolvedValue([{
      id: 'event-1',
      title: 'Client kickoff',
      startTime: startTime.toISOString(),
      color: '#3B82F6',
      attendees: [],
    }]);
    renderWithQuery(<Calendar projectId="project-1" />);

    const createTrigger = await screen.findByRole('button', { name: /new event/i });
    await user.click(createTrigger);
    expect(screen.getByRole('dialog', { name: 'Create Event' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(createTrigger).toHaveFocus();

    const event = await screen.findByText(/client kickoff/i);
    fireEvent.click(event);
    expect(screen.getByRole('dialog', { name: 'Client kickoff' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
