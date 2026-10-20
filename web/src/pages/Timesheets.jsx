import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import PortfolioFilter from '../components/PortfolioFilter';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';
import { Button, EmptyState, LoadingState } from '../components/ui';
import { buttonStyles } from '../components/ui/Button';
import QueryErrorState from '../components/QueryErrorState';
import RunningTimer from '../components/time/RunningTimer';
import TimesheetGrid from '../components/time/TimesheetGrid';
import AddTimeModal from '../components/time/AddTimeModal';
import { EntryRow, WaitingForApproval } from '../components/time/EntryReview';
import {
  cellEntries, dayLabel, dayTotals, flattenEntries, formatHours, formatWeekRange, localDateKey,
  mondayOf, projectRows, readyToBill, weekDays, weekPeople, weekStartParam, weekTotals, weekWord,
} from '../components/time/timesheetWeek';
import { cn } from '../lib/utils';

// Ashbi Hub Time page (design: Time mockup), at /timesheets. The week's hours
// per project and day, the running timer, approval and what is ready to bill.
// Admins see everyone's time and can approve or reject it; team members see
// only their own (the API scopes the week to them). No money is shown: time
// entry rates carry no currency, so hours are the only safe figure here.

const iconButton = 'inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border/60 text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
const toolbarSelect = 'min-h-11 max-w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';
const panelClass = 'rounded-lg border border-border/60 bg-card';

function Tile({ label, minutes, detail }) {
  return (
    <div className={cn(panelClass, 'px-4 py-4')}>
      <p className="text-eyebrow text-muted-foreground">{label}</p>
      <p className="mt-1.5 figure text-2xl font-medium text-foreground">{formatHours(minutes)} h</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

export default function Timesheets() {
  const [params, setParams] = useSearchParams();
  const portfolio = params.get('portfolio') || '';
  const person = (params.get('person') || '').slice(0, 80);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const canReview = user?.role === 'ADMIN';

  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [addOpen, setAddOpen] = useState(false);

  const monday = useMemo(() => mondayOf(new Date(), weekOffset), [weekOffset]);
  const weekStart = weekStartParam(monday);
  const allDays = useMemo(() => weekDays(monday), [monday]);

  const setParam = useCallback((key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next);
    setSelected(null);
  }, [params, setParams]);

  const moveWeek = (offset) => { setWeekOffset(offset); setSelected(null); };

  const {
    data,
    isLoading,
    isError: timesheetsError,
    error: timesheetsRequestError,
    refetch: refetchTimesheets,
    isFetching: timesheetsFetching,
  } = useQuery({
    queryKey: ['weekly-timesheet', weekStart, portfolio],
    queryFn: () => api.getWeeklyTimesheet(weekStart, portfolio ? { portfolio } : {}),
  });

  // Shares the header LiveTimer's query, so both show the same timer.
  const { data: runningSession } = useQuery({
    queryKey: ['running-time-session'],
    queryFn: () => api.getRunningTimeSession(),
    retry: false,
    staleTime: 30000,
  });

  // Pending reviews are tracked per entry, so one settling never re-enables
  // another entry's buttons, and an entry already in flight can't be sent twice.
  const [busyIds, setBusyIds] = useState(() => new Set());
  const markBusy = (id) => setBusyIds((current) => new Set(current).add(id));
  const settle = (id) => {
    setBusyIds((current) => { const next = new Set(current); next.delete(id); return next; });
    queryClient.invalidateQueries({ queryKey: ['weekly-timesheet'] });
  };
  const approveMutation = useMutation({
    mutationFn: (id) => api.approveTimesheetEntry(id),
    onMutate: (id) => markBusy(id),
    onSuccess: () => toast.success('Entry approved'),
    onError: () => toast.error('Approval failed'),
    onSettled: (_data, _error, id) => settle(id),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => api.rejectTimesheetEntry(id, reason),
    onMutate: ({ id }) => markBusy(id),
    onSuccess: () => toast.success('Entry rejected'),
    onError: () => toast.error('Rejection failed'),
    onSettled: (_data, _error, { id }) => settle(id),
  });
  const review = {
    isBusy: (id) => busyIds.has(id),
    approve: (id) => { if (!busyIds.has(id)) approveMutation.mutate(id); },
    reject: (id, reason) => { if (!busyIds.has(id)) rejectMutation.mutate({ id, reason }); },
  };

  const timesheets = useMemo(() => (Array.isArray(data?.timesheets) ? data.timesheets : []), [data]);
  const people = useMemo(() => weekPeople(timesheets), [timesheets]);
  const allEntries = useMemo(() => flattenEntries(timesheets), [timesheets]);
  const entries = useMemo(
    () => (canReview && person ? allEntries.filter((entry) => entry.user?.id === person) : allEntries),
    [allEntries, canReview, person],
  );
  const rows = useMemo(() => projectRows(entries), [entries]);
  const totals = useMemo(() => weekTotals(entries), [entries]);
  const totalsByDay = useMemo(() => dayTotals(entries), [entries]);
  const billable = useMemo(() => readyToBill(entries), [entries]);
  // Weekdays always; Saturday and Sunday only when someone logged time then.
  const days = allDays.filter((day) => !day.weekend || totalsByDay[day.key]);
  const showPerson = canReview && people.length > 1 && !person;

  const today = localDateKey(new Date());
  const defaultDay = allDays.some((day) => day.key === today) ? today : allDays[0].key;
  const selectedEntries = selected ? cellEntries(entries, selected.projectId, selected.dayKey) : [];
  const selectedRow = selected ? rows.find((row) => row.id === selected.projectId) : null;
  const panelId = 'timesheet-day-entries';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-eyebrow text-muted-foreground">Week of <span>{formatWeekRange(monday)}</span></p>
          <h1 className="mt-1.5 text-3xl font-heading font-semibold tracking-tight text-foreground">
            Time <span className="font-display italic font-normal text-primary">{weekWord(weekOffset)}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" aria-label="Previous week" className={iconButton} onClick={() => moveWeek(weekOffset - 1)}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next week" className={iconButton} onClick={() => moveWeek(weekOffset + 1)}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {weekOffset !== 0 && (
            <Button type="button" variant="outline" onClick={() => moveWeek(0)}>This week</Button>
          )}
          <Button type="button" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add time
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <PortfolioFilter value={portfolio} onChange={(value) => setParam('portfolio', value)} />
        {canReview && (people.length > 1 || person) && (
          <label className="text-sm">
            Person
            <select aria-label="Person" value={person} onChange={(event) => setParam('person', event.target.value)} className={cn(toolbarSelect, 'block')}>
              <option value="">Everyone</option>
              {people.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              {person && !people.some((member) => member.id === person) && <option value={person}>Selected person</option>}
            </select>
          </label>
        )}
      </div>

      {runningSession?.id && <RunningTimer session={runningSession} />}

      {!timesheetsError && !isLoading && (
        <section aria-label="This week in numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile label="Logged" minutes={totals.total} />
          <Tile label="Billable" minutes={totals.billable} detail={`${totals.total ? Math.round((totals.billable / totals.total) * 100) : 0}% of logged`} />
          {canReview
            ? <Tile label="Not billed yet" minutes={totals.notBilled} detail="Billable, not on an invoice" />
            : <Tile label="Not billable" minutes={totals.total - totals.billable} />}
          <Tile label="Waiting for OK" minutes={totals.pending} />
        </section>
      )}

      {/* Timesheet */}
      <section aria-labelledby="timesheet-heading" className={cn(panelClass, 'p-5 pb-3')}>
        <h2 id="timesheet-heading" className="mb-2 text-lg font-semibold tracking-tight text-foreground">Timesheet</h2>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <LoadingState label="Loading timesheets…" compact />
          </div>
        ) : timesheetsError ? (
          <QueryErrorState
            error={timesheetsRequestError}
            message="Timesheet data could not be loaded"
            onRetry={refetchTimesheets}
            isRetrying={timesheetsFetching}
          />
        ) : timesheets.length === 0 || rows.length === 0 ? (
          <EmptyState
            icon="tasks"
            title="No time logged this week"
            description="Start the timer in the top bar, or use Add time to log hours."
          />
        ) : (
          <>
            <TimesheetGrid rows={rows} days={days} totalsByDay={totalsByDay} total={totals.total} selected={selected} onSelect={setSelected} panelId={panelId} />
            {selected && selectedEntries.length > 0 && (
              <div id={panelId} role="region" aria-labelledby={`${panelId}-heading`} className="mt-3 rounded-md bg-muted/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id={`${panelId}-heading`} className="font-semibold text-foreground">
                    {selectedRow?.name} · {dayLabel(selected.dayKey)}
                  </h3>
                  <button type="button" aria-label="Close day entries" className={cn(iconButton, 'border-transparent')} onClick={() => setSelected(null)}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <ul>
                  {selectedEntries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} canReview={canReview} review={review} showPerson={canReview} />
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {!timesheetsError && !isLoading && (
        <div className="flex flex-wrap items-start gap-4">
          {canReview && (
            <section aria-labelledby="time-bill-heading" className={cn(panelClass, 'min-w-0 flex-[1_1_24rem] p-5')}>
              <h2 id="time-bill-heading" className="text-lg font-semibold tracking-tight text-foreground">Ready to bill</h2>
              <p className="mt-1 text-sm text-muted-foreground">Approved billable hours from this week that are not on an invoice yet.</p>
              {billable.length === 0 ? (
                <p className="mt-3 border-t border-border/40 pt-3 text-sm text-muted-foreground">No approved hours are waiting to be billed.</p>
              ) : (
                <>
                  <ul className="mt-2">
                    {billable.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/40 py-3">
                        <span className="font-semibold text-foreground">{row.name}</span>
                        <span className="figure text-sm text-muted-foreground">{formatHours(row.total)} h approved</span>
                      </li>
                    ))}
                  </ul>
                  <Link to="/invoices/unbilled" className={buttonStyles({ variant: 'primary', size: 'sm', className: 'mt-2' })}>
                    Bill approved work
                  </Link>
                </>
              )}
            </section>
          )}
          <WaitingForApproval entries={entries} canReview={canReview} review={review} showPerson={showPerson} />
        </div>
      )}

      {addOpen && <AddTimeModal isOpen onClose={() => setAddOpen(false)} days={allDays} defaultDay={defaultDay} />}
    </div>
  );
}
