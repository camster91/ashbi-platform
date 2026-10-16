import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import Timesheets from '../pages/Timesheets';
import { api } from '../lib/api';
const auth = vi.hoisted(() => ({ role: 'TEAM' }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'member-a', role: auth.role } }) }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('../lib/api', () => ({ api: { getWeeklyTimesheet: vi.fn(), approveTimesheetEntry: vi.fn(), rejectTimesheetEntry: vi.fn() } }));
afterEach(() => { auth.role = 'TEAM'; vi.clearAllMocks(); vi.useRealTimers(); });
async function openEntry() {
  api.getWeeklyTimesheet.mockImplementation(async start => ({ timesheets: [{ user: { id: 'member-a', name: 'Current member' }, totalMinutes: 60, billableMinutes: 60,
    days: { [start.slice(0, 10)]: { totalMinutes: 60, entries: [{ id: 'entry-a', duration: 60, billable: true, description: 'Personal time entry', reviewStatus: 'PENDING', project: { name: 'Client project' } }] } } }] }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={cache}><MemoryRouter><Timesheets /></MemoryRouter></QueryClientProvider>);
  expect(await screen.findByText('Current member')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /1\.0h/ }));
  expect(screen.getByText('Personal time entry')).toBeInTheDocument();
  return cache;
}
it('TEAM users can read their personal entries without administrator review controls', async () => {
  const cache = await openEntry();
  expect(screen.getByText('Pending review')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Approve|Reject/ })).not.toBeInTheDocument();
  expect(api.approveTimesheetEntry).not.toHaveBeenCalled(); expect(api.rejectTimesheetEntry).not.toHaveBeenCalled(); cache.clear();
});
it('administrator review controls remain available on the same page', async () => {
  auth.role = 'ADMIN'; const cache = await openEntry();
  expect(screen.getByRole('button', { name: 'Approve', exact: true })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reject', exact: true })).toBeInTheDocument(); cache.clear();
});


it.each([
  { now: new Date(2026, 9, 14, 12), start: new Date(2026, 9, 12), end: new Date(2026, 9, 18), crossesYear: false },
  { now: new Date(2026, 11, 30, 12), start: new Date(2026, 11, 28), end: new Date(2027, 0, 3), crossesYear: true },
])('formats the visible week with correct locale arguments and years ($crossesYear)', ({ now, start, end, crossesYear }) => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  api.getWeeklyTimesheet.mockResolvedValue({ timesheets: [] });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={cache}><MemoryRouter><Timesheets /></MemoryRouter></QueryClientProvider>);
  const startLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', ...(crossesYear ? { year: 'numeric' } : {}) }).format(start);
  const endLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(end);
  const label = screen.getByText(startLabel + ' – ' + endLabel);
  expect(label.textContent.match(/2026/g)).toHaveLength(1);
  if (crossesYear) expect(label).toHaveTextContent('2027');
  expect(api.getWeeklyTimesheet).toHaveBeenCalledWith(expect.any(String), {});
  view.unmount(); cache.clear();
});
