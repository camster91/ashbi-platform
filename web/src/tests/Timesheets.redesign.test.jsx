import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { user: { id: 'u-cam', name: 'Cameron Ashley', role: 'ADMIN' } };

vi.mock('../lib/api', () => ({
  api: {
    getWeeklyTimesheet: vi.fn(),
    getRunningTimeSession: vi.fn(),
    stopTimeSession: vi.fn(async () => ({})),
    approveTimesheetEntry: vi.fn(async () => ({})),
    rejectTimesheetEntry: vi.fn(async () => ({})),
    getProjects: vi.fn(),
    createTimeEntry: vi.fn(async () => ({})),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => authState }));
vi.mock('../hooks/useToast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

const { default: Timesheets } = await import('../pages/Timesheets');
const { api } = await import('../lib/api');
const { localDateKey, mondayOf, weekStartParam } = await import('../components/time/timesheetWeek');

const cam = { id: 'u-cam', name: 'Cameron Ashley' };
const bia = { id: 'u-bia', name: 'Bianca Ross' };
const harbour = { id: 'p-harbour', name: 'Website rebuild' };
const golden = { id: 'p-golden', name: 'Shopify store' };
const internal = { id: 'p-int', name: 'Ashbi internal' };

// Day key `offset` days after the requested Monday ("2026-10-12" + 1 → "2026-10-13").
function dayAfter(weekStart, offset) {
  const date = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function sheet(user, weekStart, list) {
  const days = {};
  for (const [offset, entry] of list) {
    const key = dayAfter(weekStart, offset);
    days[key] ??= { entries: [], totalMinutes: 0 };
    days[key].entries.push(entry);
    days[key].totalMinutes += entry.duration;
  }
  return { user, days, totalMinutes: 0, billableMinutes: 0 };
}

// Cameron: 2.0 h approved (Mon) + 3.5 h pending (Tue) on Website rebuild.
// Bianca: 1.0 h invoiced (Mon) + 1.5 h pending (Wed) on Shopify store, 1.0 h
// non-billable approved internal time (Thu).
function adminWeek(weekStart) {
  return {
    timesheets: [
      sheet(cam, weekStart, [
        [0, { id: 'e-mon', duration: 120, billable: true, reviewStatus: 'APPROVED', invoiced: false, description: 'Header build', project: harbour, hourlyRate: 95 }],
        [1, { id: 'e-tue', duration: 210, billable: true, reviewStatus: 'PENDING', invoiced: false, description: 'Booking widget', project: harbour }],
      ]),
      sheet(bia, weekStart, [
        [0, { id: 'e-gold', duration: 60, billable: true, reviewStatus: 'APPROVED', invoiced: true, invoiceId: 'inv-1', description: 'Theme setup', project: golden }],
        [2, { id: 'e-wed', duration: 90, billable: true, reviewStatus: 'PENDING', invoiced: false, description: 'Product page', project: golden }],
        [3, { id: 'e-int', duration: 60, billable: false, reviewStatus: 'APPROVED', invoiced: false, description: 'Studio admin', project: internal }],
      ]),
    ],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}</output>;
}

function renderTime(path = '/timesheets') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes><Route path="/timesheets" element={<Timesheets />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const grid = () => screen.getByRole('table', { name: 'Hours per project and day' });
const tiles = () => screen.getByRole('region', { name: 'This week in numbers' });
const waiting = () => screen.getByRole('region', { name: 'Waiting for OK' });

describe('Time page redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'u-cam', name: 'Cameron Ashley', role: 'ADMIN' };
    api.getWeeklyTimesheet.mockImplementation(async (weekStart) => adminWeek(weekStart));
    api.getRunningTimeSession.mockResolvedValue(null);
    api.getProjects.mockResolvedValue({ projects: [harbour, { ...golden, client: { name: 'Golden and Salty' } }] });
  });

  it('asks for the week from UTC midnight of the local Monday and shows the mockup header', async () => {
    renderTime();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Time this week');
    const monday = mondayOf(new Date());
    expect(api.getWeeklyTimesheet).toHaveBeenCalledWith(`${localDateKey(monday)}T00:00:00.000Z`, {});
    expect(weekStartParam(new Date(2026, 9, 12))).toBe('2026-10-12T00:00:00.000Z');
    expect(screen.getByText(/^Week of/)).toHaveClass('text-eyebrow');
    expect(screen.queryByRole('button', { name: 'This week' })).not.toBeInTheDocument();
  });

  it('sums the week in hours, with no money', async () => {
    const { container } = renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const numbers = tiles();
    expect(numbers).toHaveTextContent('Logged9.0 h');
    expect(numbers).toHaveTextContent('Billable8.0 h89% of logged');
    expect(numbers).toHaveTextContent('Not billed yet7.0 hBillable, not on an invoice');
    expect(numbers).toHaveTextContent('Waiting for OK5.0 h');
    expect(container.textContent).not.toMatch(/\$|95/);
  });

  it('shows one row per project with day and week totals, and weekdays only', async () => {
    renderTime();
    const table = await screen.findByRole('table', { name: 'Hours per project and day' });
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toHaveLength(7);
    expect(headers[0]).toBe('Project');
    expect(headers[1]).toMatch(/^Mon \d+$/);
    expect(headers[5]).toMatch(/^Fri \d+$/);
    expect(headers[6]).toBe('Total');

    const rowNames = within(table).getAllByRole('rowheader').map((cell) => cell.textContent);
    expect(rowNames).toEqual(['Website rebuildBillable', 'Shopify storeBillable', 'Ashbi internalNot billable', 'Total']);
    const harbourRow = within(table).getByRole('rowheader', { name: /Website rebuild/ }).closest('tr');
    expect(within(harbourRow).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['2.0', '3.5', '–No time', '–No time', '–No time', '5.5']);
    const totalRow = within(table).getByRole('rowheader', { name: 'Total' }).closest('tr');
    expect(within(totalRow).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['3.0', '3.5', '1.5', '1.0', '–No time', '9.0']);
  });

  it('adds Saturday when time was logged on it', async () => {
    api.getWeeklyTimesheet.mockImplementation(async (weekStart) => ({
      timesheets: [sheet(cam, weekStart, [[5, { id: 'e-sat', duration: 30, billable: true, reviewStatus: 'PENDING', project: harbour }]])],
    }));
    renderTime();
    const table = await screen.findByRole('table', { name: 'Hours per project and day' });
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toHaveLength(8);
    expect(headers[6]).toMatch(/^Sat \d+$/);
  });

  it('opens a cell to list its entries with the person and review state', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const cell = within(grid()).getByRole('button', { name: /^Website rebuild, Tue \d+: 3\.5 hours$/ });
    expect(cell).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(cell);
    expect(cell).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: /^Website rebuild · / });
    expect(cell).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveTextContent('Cameron Ashley · Booking widget · billable');
    expect(within(panel).getByRole('button', { name: 'Approve Booking widget' })).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Close day entries' }));
    expect(screen.queryByRole('region', { name: /^Website rebuild · / })).not.toBeInTheDocument();
    expect(cell).toHaveAttribute('aria-expanded', 'false');
  });

  it('lets an admin approve, and reject only with a reason, from Waiting for OK', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const list = waiting();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list).toHaveTextContent('3.5 h (3.5 hours) · Website rebuild');
    expect(list).toHaveTextContent('Bianca Ross');

    fireEvent.click(within(list).getByRole('button', { name: 'Approve Booking widget' }));
    await waitFor(() => expect(api.approveTimesheetEntry).toHaveBeenCalledWith('e-tue'));

    fireEvent.click(within(list).getByRole('button', { name: 'Reject Product page' }));
    const confirm = within(list).getByRole('button', { name: 'Confirm rejection' });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(list).getByLabelText('Rejection reason'), { target: { value: 'Wrong project' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectTimesheetEntry).toHaveBeenCalledWith('e-wed', 'Wrong project'));
  });

  it('keeps an in-flight review locked when another entry\'s review finishes first', async () => {
    let finishTue;
    api.approveTimesheetEntry.mockImplementation((id) => (id === 'e-tue'
      ? new Promise((resolve) => { finishTue = resolve; })
      : Promise.resolve({})));
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const list = waiting();
    fireEvent.click(within(list).getByRole('button', { name: 'Approve Booking widget' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Approve Product page' }));
    await waitFor(() => expect(api.approveTimesheetEntry).toHaveBeenCalledWith('e-wed'));
    // e-wed settled; e-tue is still pending, so its buttons stay locked and a
    // second approve is not sent.
    await waitFor(() => expect(within(list).getByRole('button', { name: 'Reject Booking widget' })).toBeDisabled());
    fireEvent.click(within(list).getByRole('button', { name: 'Approve Booking widget' }));
    expect(api.approveTimesheetEntry.mock.calls.filter(([id]) => id === 'e-tue')).toHaveLength(1);
    finishTue({});
  });

  it('gives each open rejection field its own id', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const list = waiting();
    fireEvent.click(within(list).getByRole('button', { name: 'Reject Booking widget' }));
    fireEvent.click(within(grid()).getByRole('button', { name: /^Website rebuild, Tue \d+: 3\.5 hours$/ }));
    const panel = screen.getByRole('region', { name: /^Website rebuild · / });
    fireEvent.click(within(panel).getByRole('button', { name: 'Reject Booking widget' }));
    const fields = screen.getAllByLabelText('Rejection reason');
    expect(fields).toHaveLength(2);
    expect(fields[0].id).not.toBe(fields[1].id);
  });

  it('lists approved, uninvoiced billable hours as ready to bill', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const ready = screen.getByRole('region', { name: 'Ready to bill' });
    expect(within(ready).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Website rebuild2.0 h approved']);
    expect(within(ready).getByRole('link', { name: 'Bill approved work' })).toHaveAttribute('href', '/invoices/unbilled');
  });

  it('filters to one person in the URL', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    const select = screen.getByLabelText('Person');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Everyone', 'Bianca Ross', 'Cameron Ashley']);
    fireEvent.change(select, { target: { value: 'u-bia' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/timesheets?person=u-bia');
    expect(within(grid()).queryByRole('rowheader', { name: /Website rebuild/ })).not.toBeInTheDocument();
    expect(within(grid()).getByRole('rowheader', { name: /Shopify store/ })).toBeInTheDocument();
    expect(tiles()).toHaveTextContent('Logged3.5 h');
  });

  it('moves between weeks and back to this week', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Time last week');
    const previous = mondayOf(new Date(), -1);
    await waitFor(() => expect(api.getWeeklyTimesheet).toHaveBeenLastCalledWith(weekStartParam(previous), {}));
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Time that week');
    fireEvent.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Time this week');
  });

  it('shows the running timer and stops it', async () => {
    api.getRunningTimeSession.mockResolvedValue({
      id: 'session-a', startTime: new Date(Date.now() - (42 * 60 + 10) * 1000).toISOString(),
      description: 'Date picker', project: harbour, task: { id: 't', title: 'Booking widget' },
    });
    renderTime();
    const band = await screen.findByRole('region', { name: 'Running timer' });
    expect(band).toHaveTextContent('Booking widget');
    expect(band).toHaveTextContent('Website rebuild · Date picker');
    expect(band).toHaveTextContent(/0:42:1\d/);
    expect(band).toHaveTextContent('Running for 42 minutes');
    expect(band).toHaveClass('bg-primary', 'text-primary-foreground');

    api.getRunningTimeSession.mockResolvedValue(null);
    fireEvent.click(within(band).getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(api.stopTimeSession).toHaveBeenCalledWith('session-a'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Running timer' })).not.toBeInTheDocument());
  });

  it('adds time on a project for a day of the week', async () => {
    renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    const dialog = screen.getByRole('dialog', { name: 'Add time' });
    await within(dialog).findByRole('option', { name: 'Shopify store — Golden and Salty' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save time' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose a project.');
    expect(api.createTimeEntry).not.toHaveBeenCalled();

    const monday = localDateKey(mondayOf(new Date()));
    fireEvent.change(within(dialog).getByLabelText(/Project/), { target: { value: 'p-golden' } });
    fireEvent.change(within(dialog).getByLabelText(/Day/), { target: { value: monday } });
    fireEvent.change(within(dialog).getByLabelText(/Hours/), { target: { value: '1.5' } });
    fireEvent.change(within(dialog).getByLabelText(/What did you work on/), { target: { value: ' Product page ' } });
    fireEvent.click(within(dialog).getByLabelText('Billable'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save time' }));
    await waitFor(() => expect(api.createTimeEntry).toHaveBeenCalledWith({
      projectId: 'p-golden', duration: 90, date: `${monday}T12:00:00.000Z`, billable: false, description: 'Product page',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add time' })).not.toBeInTheDocument());
  });

  it('shows team members their own time without review controls or billing', async () => {
    authState.user = { id: 'u-bia', name: 'Bianca Ross', role: 'TEAM' };
    api.getWeeklyTimesheet.mockImplementation(async (weekStart) => ({ timesheets: [adminWeek(weekStart).timesheets[1]] }));
    const { container } = renderTime();
    await screen.findByRole('table', { name: 'Hours per project and day' });
    expect(screen.queryByRole('button', { name: /Approve|Reject/ })).not.toBeInTheDocument();
    expect(within(waiting()).getByText('Pending review')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Ready to bill' })).not.toBeInTheDocument();
    expect(tiles()).not.toHaveTextContent('Not billed yet');
    expect(tiles()).toHaveTextContent('Not billable1.0 h');
    expect(screen.queryByLabelText('Person')).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\$|invoice/i);
  });

  it('shows an empty week, and a retryable error', async () => {
    api.getWeeklyTimesheet.mockResolvedValue({ timesheets: [] });
    const { unmount } = renderTime();
    expect(await screen.findByRole('heading', { name: 'No time logged this week' })).toBeInTheDocument();
    expect(within(waiting()).getByText('Nothing is waiting for approval this week.')).toBeInTheDocument();
    unmount();

    api.getWeeklyTimesheet.mockRejectedValueOnce(new Error('Server error'));
    renderTime();
    expect(await screen.findByText('Timesheet data could not be loaded')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'This week in numbers' })).not.toBeInTheDocument();
    api.getWeeklyTimesheet.mockImplementation(async (weekStart) => adminWeek(weekStart));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Hours per project and day' })).toBeInTheDocument();
  });
});
