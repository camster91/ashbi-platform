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
afterEach(() => { auth.role = 'TEAM'; vi.clearAllMocks(); });
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
