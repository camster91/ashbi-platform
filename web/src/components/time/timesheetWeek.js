// Week maths and grouping for the Time page (pages/Timesheets.jsx).
//
// The API groups entries by the UTC calendar date of `entry.date` and reads
// the window [weekStart, weekStart + 7 days). Manual entries are saved at a
// UTC date, so the week is asked for from UTC midnight of the local Monday's
// date: a local-midnight ISO string (2026-10-12T04:00Z in Toronto) dropped the
// Monday's manual entries and pulled in the next Monday's.

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** "2026-10-12" from a local date's own year, month and day. */
export function localDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight of the Monday of `date`'s week, moved by `offset` weeks. */
export function mondayOf(date, offset = 0) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The `weekStart` query value: UTC midnight of the Monday's calendar date. */
export function weekStartParam(monday) {
  return `${localDateKey(monday)}T00:00:00.000Z`;
}

/** Seven days from Monday: `{ key: '2026-10-12', name: 'Mon', day: 12, date }`. */
export function weekDays(monday) {
  return DAY_NAMES.map((name, index) => {
    const date = new Date(monday);
    date.setDate(date.getDate() + index);
    return { key: localDateKey(date), name, day: date.getDate(), date, weekend: index >= 5 };
  });
}

/** "Oct 12 – Oct 18, 2026" (the start gets its own year when the week crosses one). */
export function formatWeekRange(monday) {
  const start = new Date(monday);
  const end = new Date(monday);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const crossesYear = start.getFullYear() !== end.getFullYear();
  const first = start.toLocaleDateString(undefined, { ...opts, ...(crossesYear ? { year: 'numeric' } : {}) });
  const last = end.toLocaleDateString(undefined, { ...opts, year: 'numeric' });
  return `${first} – ${last}`;
}

/** "Mon, Oct 12" for a day key. */
export function dayLabel(dayKey) {
  const date = new Date(`${dayKey}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dayKey;
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The serif word in "Time this week". */
export function weekWord(offset) {
  if (offset === 0) return 'this week';
  if (offset === -1) return 'last week';
  if (offset === 1) return 'next week';
  return 'that week';
}

/** Minutes as hours with one decimal: 90 → "1.5". */
export function formatHours(minutes) {
  return ((Number(minutes) || 0) / 60).toFixed(1);
}

/** Plain-words hours for screen readers: 90 → "1.5 hours", 60 → "1.0 hour". */
export function spokenHours(minutes) {
  const value = formatHours(minutes);
  return `${value} ${value === '1.0' ? 'hour' : 'hours'}`;
}

/**
 * Every entry in the weekly response, with its person and day key. The
 * response is `{ timesheets: [{ user, days: { [dayKey]: { entries } } }] }`.
 */
export function flattenEntries(timesheets) {
  const entries = [];
  for (const sheet of Array.isArray(timesheets) ? timesheets : []) {
    for (const [dayKey, day] of Object.entries(sheet?.days || {})) {
      for (const entry of day?.entries || []) {
        entries.push({ ...entry, user: entry.user || sheet.user || null, dayKey });
      }
    }
  }
  return entries;
}

/** People who logged time this week, for the admin person filter. */
export function weekPeople(timesheets) {
  return (Array.isArray(timesheets) ? timesheets : [])
    .map((sheet) => sheet?.user)
    .filter((user) => user?.id)
    .map((user) => ({ id: user.id, name: user.name || 'Unknown teammate' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const projectKey = (entry) => entry.project?.id || entry.projectId || 'no-project';
const projectName = (entry) => entry.project?.name || 'Unavailable project';

/**
 * One timesheet row per project, most hours first:
 * `{ id, name, total, billable, byDay: { [dayKey]: minutes } }`.
 */
export function projectRows(entries) {
  const rows = new Map();
  for (const entry of entries) {
    const id = projectKey(entry);
    if (!rows.has(id)) rows.set(id, { id, name: projectName(entry), total: 0, billable: 0, byDay: {} });
    const row = rows.get(id);
    const minutes = entry.duration || 0;
    row.total += minutes;
    if (entry.billable) row.billable += minutes;
    row.byDay[entry.dayKey] = (row.byDay[entry.dayKey] || 0) + minutes;
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Entries of one project on one day, for the cell detail panel. */
export function cellEntries(entries, projectId, dayKey) {
  return entries.filter((entry) => projectKey(entry) === projectId && entry.dayKey === dayKey);
}

export const isPending = (entry) => !entry.reviewStatus || entry.reviewStatus === 'PENDING';
const isBilled = (entry) => Boolean(entry.invoiced || entry.invoiceId);

/**
 * The four tiles: logged, billable, not billed yet (billable, not invoiced and
 * not rejected) and waiting for approval. All in minutes; no money.
 */
export function weekTotals(entries) {
  const totals = { total: 0, billable: 0, notBilled: 0, pending: 0 };
  for (const entry of entries) {
    const minutes = entry.duration || 0;
    totals.total += minutes;
    if (entry.billable) totals.billable += minutes;
    if (entry.billable && !isBilled(entry) && entry.reviewStatus !== 'REJECTED') totals.notBilled += minutes;
    if (isPending(entry)) totals.pending += minutes;
  }
  return totals;
}

/** Minutes per day key, for the timesheet's total row. */
export function dayTotals(entries) {
  const totals = {};
  for (const entry of entries) totals[entry.dayKey] = (totals[entry.dayKey] || 0) + (entry.duration || 0);
  return totals;
}

/** Approved, billable time that is on no invoice yet, per project. */
export function readyToBill(entries) {
  return projectRows(entries.filter((entry) => entry.reviewStatus === 'APPROVED' && entry.billable && !isBilled(entry)));
}

/** Entries waiting for an admin's approval, oldest day first. */
export function pendingEntries(entries) {
  return entries
    .filter(isPending)
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || String(a.id).localeCompare(String(b.id)));
}
