import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuditEvents = vi.fn();
const getAuditEventCatalog = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getAuditEvents: (...args) => getAuditEvents(...args),
    getAuditEventCatalog: (...args) => getAuditEventCatalog(...args),
  },
}));

const { default: ActivityLog, toAuditQuery } = await import('../components/ActivityLog');

function renderLog() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActivityLog />
    </QueryClientProvider>,
  );
}

const EVENT = {
  id: 'e1',
  action: 'invoice.paid',
  actorType: 'WEBHOOK',
  actorUserId: null,
  actorName: null,
  entityType: 'invoice',
  entityId: 'inv-1',
  requestId: 'req-9',
  ip: null,
  metadata: { method: 'STRIPE', total: 113 },
  createdAt: '2026-09-25T12:00:00.000Z',
};

describe('activity log', () => {
  beforeEach(() => {
    getAuditEvents.mockReset();
    getAuditEventCatalog.mockReset();
    getAuditEventCatalog.mockResolvedValue({
      actions: ['invoice.paid', 'user.role_changed'],
      entityTypes: ['invoice', 'user'],
      actorTypes: ['USER', 'WEBHOOK'],
    });
  });

  it('announces loading, then renders an accessible table of events', async () => {
    getAuditEvents.mockResolvedValue({ events: [EVENT], nextCursor: null });
    renderLog();
    expect(screen.getByRole('status', { name: 'Loading activity log…' })).toBeInTheDocument();

    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
      .toEqual(['When', 'Action', 'Actor', 'Entity', 'Details']);
    expect(within(table).getByText('invoice.paid')).toBeInTheDocument();
    expect(within(table).getByText('Payment provider')).toBeInTheDocument();
    expect(within(table).getByText('STRIPE')).toBeInTheDocument();
    expect(within(table).getByText('Request req-9')).toBeInTheDocument();
    // Metadata is a valid description list: dt/dd pairs directly under dl.
    const list = table.querySelector('dl');
    expect([...list.children].map((node) => node.tagName)).toEqual(['DT', 'DD', 'DT', 'DD']);
    expect(screen.getByTestId('activity-log-results')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: /load older events/i })).not.toBeInTheDocument();
  });

  it('shows an empty state that distinguishes no history from no matches', async () => {
    getAuditEvents.mockResolvedValue({ events: [], nextCursor: null });
    renderLog();
    expect(await screen.findByText('No activity recorded yet')).toBeInTheDocument();

    await screen.findByRole('option', { name: 'user.role_changed' });
    fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'user.role_changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    expect(await screen.findByText('No events match these filters')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('activity-log-results')).toHaveTextContent('No events match these filters.'));
    expect(screen.getByTestId('activity-log-results')).toHaveAttribute('aria-live', 'polite');
    expect(getAuditEvents).toHaveBeenLastCalledWith({ action: 'user.role_changed', limit: 50, cursor: undefined });

    getAuditEvents.mockResolvedValue({ events: [EVENT, { ...EVENT, id: 'e2' }], nextCursor: 'more' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(screen.getByTestId('activity-log-results')).toHaveTextContent('2 events shown, older events available.'));
  });

  it('shows a retryable error state', async () => {
    getAuditEvents.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    renderLog();
    expect(await screen.findByText('The activity log could not be loaded')).toBeInTheDocument();
    expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();

    getAuditEvents.mockResolvedValue({ events: [EVENT], nextCursor: null });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('pages older events with the server cursor', async () => {
    getAuditEvents
      .mockResolvedValueOnce({ events: [EVENT], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ events: [{ ...EVENT, id: 'e0', action: 'user.role_changed', actorType: 'USER', actorName: 'Ada Admin' }], nextCursor: null });
    renderLog();
    fireEvent.click(await screen.findByRole('button', { name: 'Load older events' }));
    await waitFor(() => expect(screen.getByText('Ada Admin')).toBeInTheDocument());
    expect(getAuditEvents).toHaveBeenLastCalledWith({ limit: 50, cursor: 'cursor-1' });
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Load older events' })).not.toBeInTheDocument();
  });

  it('turns local calendar days into an inclusive ISO range', () => {
    const query = toAuditQuery({ action: '', entityType: 'invoice', actorType: '', entityId: ' inv-1 ', from: '2026-09-01', to: '2026-09-02' });
    expect(query.entityType).toBe('invoice');
    expect(query.entityId).toBe('inv-1');
    expect(new Date(query.from).getTime()).toBe(new Date('2026-09-01T00:00:00').getTime());
    expect(new Date(query.to).getTime()).toBe(new Date('2026-09-02T23:59:59.999').getTime());
    expect(query).not.toHaveProperty('action');
  });
});
