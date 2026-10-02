import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import PortalBooking, { slotUtcOffsetLabel } from '../pages/PortalBooking';

vi.mock('../lib/api', () => ({
  api: { getPortalBookingSlots: vi.fn(async () => ({ slots: [] })), createPortalBooking: vi.fn() },
}));

describe('slotUtcOffsetLabel', () => {
  it('derives the server-local offset from the slot wall-clock time and its UTC start', () => {
    expect(slotUtcOffsetLabel('2026-10-05', { time: '09:00', start: '2026-10-05T13:00:00.000Z' })).toBe('UTC-4');
    expect(slotUtcOffsetLabel('2026-10-05', { time: '09:00', start: '2026-10-05T03:30:00.000Z' })).toBe('UTC+5:30');
    expect(slotUtcOffsetLabel('2026-10-05', { time: '09:00', start: '2026-10-05T09:00:00.000Z' })).toBe('UTC');
  });

  it('returns null when the slot has no absolute start', () => {
    expect(slotUtcOffsetLabel('2026-10-05', '09:00')).toBeNull();
    expect(slotUtcOffsetLabel('2026-10-05', { time: '09:00' })).toBeNull();
    expect(slotUtcOffsetLabel('', { time: '09:00', start: '2026-10-05T13:00:00.000Z' })).toBeNull();
  });
});

describe('PortalBooking calendar header', () => {
  it('names the month instead of showing a numeric date', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter><PortalBooking /></MemoryRouter>
      </QueryClientProvider>,
    );
    const monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    expect(screen.getByText(monthName)).toBeInTheDocument();
    expect(screen.queryByText(/^\d{1,2}\/\d{1,2}\/\d{4}$/)).toBeNull();
  });
});
