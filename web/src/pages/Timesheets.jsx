import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, Clock, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, DollarSign, Users, CalendarDays
} from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from '../hooks/useToast';
import { Card, Button } from '../components/ui';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatMinutes(m) {
  if (!m) return '0:00';
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h}:${min.toString().padStart(2, '0')}`;
}

function formatHours(m) {
  if (!m) return '0.0';
  return (m / 60).toFixed(1);
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

function formatWeekRange(weekStart) {
  const ws = new Date(weekStart);
  const we = new Date(weekStart);
  we.setDate(we.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const yr = ws.getFullYear();
  return `${ws.toLocaleDateString('en-US', opts)} – ${we.toLocaleDateString('en-US', { ...opts, year: we.getFullYear() !== yr ? 'numeric' : undefined })}, ${yr}`;
}

export default function Timesheets() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [weekOffset, setWeekOffset] = useState(0);
  const [expandedCell, setExpandedCell] = useState(null);

  const weekStart = useMemo(() => {
    const base = getWeekStart(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);

  const { data, isLoading } = useQuery({
    queryKey: ['weekly-timesheet', weekStart.toISOString()],
    queryFn: () => api.getWeeklyTimesheet(weekStart.toISOString()),
  });

  const { data: team } = useQuery({
    queryKey: ['team'],
    queryFn: () => api.getTeam(),
  });

  const approveMutation = useMutation({
    mutationFn: (id) => api.approveTimesheetEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-timesheet'] });
      toast.success('Entry approved');
    },
    onError: () => toast.error('Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id) => api.approveTimesheetEntry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['weekly-timesheet'] });
      toast.success('Entry rejected');
    },
    onError: () => toast.error('Rejection failed'),
  });

  const timesheets = data?.timesheets ?? [];

  // Grand totals across all users
  const grandTotals = useMemo(() => {
    const totals = { total: 0, billable: 0, byDay: {} };
    weekDates.forEach(d => { totals.byDay[d] = { total: 0, billable: 0 }; });
    timesheets.forEach(ts => {
      totals.total += ts.totalMinutes || 0;
      totals.billable += ts.billableMinutes || 0;
      weekDates.forEach(dateKey => {
        const day = ts.days?.[dateKey];
        if (day) {
          totals.byDay[dateKey].total += day.totalMinutes || 0;
          totals.byDay[dateKey].billable += day.entries?.filter(e => e.billable).reduce((s, e) => s + (e.duration || 0), 0) || 0;
        }
      });
    });
    return totals;
  }, [timesheets, weekDates]);

  const handleCellClick = useCallback((userId, dateKey) => {
    const key = `${userId}-${dateKey}`;
    setExpandedCell(prev => prev === key ? null : key);
  }, []);

  const isThisWeek = weekOffset === 0;

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            Timesheets
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly hours overview for your team
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(w => w - 1)}
            leftIcon={<ChevronLeft className="w-4 h-4" />}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(0)}
            disabled={isThisWeek}
          >
            This Week
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekOffset(w => w + 1)}
            rightIcon={<ChevronRight className="w-4 h-4" />}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Week label */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarDays className="w-4 h-4" />
        <span className="font-medium text-foreground">{formatWeekRange(weekStart)}</span>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Hours</p>
          <p className="text-2xl font-bold mt-1">{formatHours(grandTotals.total)}h</p>
          <p className="text-xs text-muted-foreground mt-0.5">{timesheets.length} team members</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Billable</p>
          <p className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">
            {formatHours(grandTotals.billable)}h
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Non-Billable</p>
          <p className="text-2xl font-bold mt-1 text-muted-foreground">
            {formatHours(grandTotals.total - grandTotals.billable)}h
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">Utilization</p>
          <p className="text-2xl font-bold mt-1">
            {grandTotals.total > 0
              ? Math.round((grandTotals.billable / grandTotals.total) * 100)
              : 0}%
          </p>
        </Card>
      </div>

      {/* Weekly grid */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : timesheets.length === 0 ? (
        <Card className="p-12 text-center">
          <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium">No timesheet data</h3>
          <p className="text-sm text-muted-foreground mt-1">
            No hours logged for this week yet.
          </p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Table header */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide w-44">
                    Team Member
                  </th>
                  {weekDates.map((dateKey, i) => {
                    const d = new Date(dateKey + 'T12:00:00');
                    const isWeekend = i >= 5;
                    return (
                      <th
                        key={dateKey}
                        className={`px-3 py-3 text-center text-xs font-medium uppercase tracking-wide ${isWeekend ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
                      >
                        <div>{DAYS[i]}</div>
                        <div className="text-[10px] mt-0.5 font-normal normal-case">
                          {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {timesheets.map((ts) => {
                  const user = ts.user || {};
                  const weeklyBillable = ts.billableMinutes || 0;
                  const weeklyNonBillable = (ts.totalMinutes || 0) - weeklyBillable;

                  return (
                    <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                      {/* Name cell */}
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-foreground">{user.name || 'Unknown'}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                            <DollarSign className="w-2.5 h-2.5" />{formatHours(weeklyBillable)}h
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatHours(weeklyNonBillable)}h non
                          </span>
                        </div>
                      </td>

                      {/* Day cells */}
                      {weekDates.map((dateKey, i) => {
                        const day = ts.days?.[dateKey];
                        const totalMin = day?.totalMinutes || 0;
                        const cellKey = `${user.id}-${dateKey}`;
                        const isExpanded = expandedCell === cellKey;
                        const isWeekend = i >= 5;

                        const dayBillable = day?.entries?.filter(e => e.billable).reduce((s, e) => s + (e.duration || 0), 0) || 0;
                        const dayNonBillable = totalMin - dayBillable;

                        return (
                          <td
                            key={dateKey}
                            className={`px-1 py-2 ${isWeekend ? 'bg-muted/20' : ''}`}
                          >
                            {/* Clickable cell */}
                            {totalMin > 0 ? (
                              <div className="text-center">
                                <button
                                  onClick={() => handleCellClick(user.id, dateKey)}
                                  className="inline-flex flex-col items-center gap-0.5 px-2 py-1 rounded-md hover:bg-muted/50 transition-colors cursor-pointer w-full"
                                >
                                  <span className="text-sm font-medium text-foreground tabular-nums">
                                    {formatHours(totalMin)}h
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" title="Billable" />
                                    <span className="w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500" title="Non-billable" />
                                  </div>
                                  <div className="flex items-center gap-1 text-[9px]">
                                    <span className="text-green-600 dark:text-green-400">{formatHours(dayBillable)}</span>
                                    <span className="text-muted-foreground">/</span>
                                    <span className="text-muted-foreground">{formatHours(dayNonBillable)}</span>
                                  </div>
                                </button>

                                {/* Expanded entries */}
                                {isExpanded && day?.entries?.length > 0 && (
                                  <div className="mt-1 space-y-1 text-left">
                                    {day.entries.map(entry => (
                                      <EntryDetail
                                        key={entry.id}
                                        entry={entry}
                                        onApprove={() => approveMutation.mutate(entry.id)}
                                        onReject={() => rejectMutation.mutate(entry.id)}
                                        isApproving={approveMutation.isPending}
                                        isRejecting={rejectMutation.isPending}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="text-center text-muted-foreground/40 text-sm">—</div>
                            )}
                          </td>
                        );
                      })}

                      {/* Weekly total cell */}
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          {formatHours(ts.totalMinutes)}h
                        </span>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatHours(weeklyBillable)}b / {formatHours(weeklyNonBillable)}nb
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {/* Summary row */}
                <tr className="bg-muted/30 border-t-2 border-border font-semibold">
                  <td className="px-4 py-3 text-sm text-foreground">
                    Totals
                  </td>
                  {weekDates.map((dateKey, i) => {
                    const dt = grandTotals.byDay[dateKey];
                    const isWeekend = i >= 5;
                    return (
                      <td
                        key={dateKey}
                        className={`px-3 py-3 text-center ${isWeekend ? 'bg-muted/20' : ''}`}
                      >
                        <div className="text-sm font-bold text-foreground tabular-nums">
                          {formatHours(dt.total)}h
                        </div>
                        <div className="text-[10px] text-green-600 dark:text-green-400">
                          {formatHours(dt.billable)} billable
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 text-right">
                    <div className="text-base font-bold text-foreground tabular-nums">
                      {formatHours(grandTotals.total)}h
                    </div>
                    <div className="text-[10px] text-green-600 dark:text-green-400">
                      {formatHours(grandTotals.billable)} billable
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
          Billable hours
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-400 dark:bg-gray-500" />
          Non-billable hours
        </div>
        <div className="flex items-center gap-1.5">
          Click any cell with hours to expand individual entries
        </div>
      </div>
    </div>
  );
}

/* ─── Entry detail sub-component ─── */

function EntryDetail({ entry, onApprove, onReject, isApproving, isRejecting }) {
  const hours = formatHours(entry.duration);
  const isBillable = entry.billable;

  return (
    <div className="px-2 py-1.5 rounded-md bg-background border border-border text-[11px] leading-snug space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground truncate">
            {entry.description || entry.task?.title || '—'}
          </div>
          {entry.project && (
            <div className="text-muted-foreground truncate">{entry.project.name}</div>
          )}
        </div>
        <div className="flex flex-col items-end flex-shrink-0">
          <span className={`font-semibold tabular-nums ${isBillable ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
            {hours}h
          </span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
            isBillable
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : 'bg-muted text-muted-foreground'
          }`}>
            {isBillable ? 'Billable' : 'Non-bill'}
          </span>
        </div>
      </div>

      {/* Approve / Reject */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border">
        <button
          onClick={onApprove}
          disabled={isApproving}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors disabled:opacity-50"
        >
          <CheckCircle2 className="w-2.5 h-2.5" /> Approve
        </button>
        <button
          onClick={onReject}
          disabled={isRejecting}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400 dark:hover:bg-red-900/50 transition-colors disabled:opacity-50"
        >
          <XCircle className="w-2.5 h-2.5" /> Reject
        </button>
      </div>
    </div>
  );
}