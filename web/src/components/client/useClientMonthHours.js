import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';

// Hours logged on this client's projects in the current calendar month, from
// GET /api/time-entries/summary (one request, grouped by project). Admins get
// everyone's time; the server gives team members only their own, so the page
// labels it "Your hours".

export function currentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, -1);
  return { start, end };
}

export function monthName(date) {
  return date.toLocaleDateString(undefined, { month: 'long' });
}

const roundHours = (minutes) => Math.round((minutes / 60) * 10) / 10;

export default function useClientMonthHours({ projects = [], role, enabled = true }) {
  const { start, end } = currentMonthRange();
  const projectIds = new Set(projects.map((project) => project.id));
  const query = useQuery({
    queryKey: ['time-entry-summary', start.toISOString(), role],
    queryFn: () => api.getTimeEntrySummary({ startDate: start.toISOString(), endDate: end.toISOString() }),
    enabled,
    retry: false,
  });
  const rows = (query.data?.byProject || []).filter((row) => projectIds.has(row.project?.id));
  const minutes = rows.reduce((sum, row) => sum + (row.totalMinutes || 0), 0);
  return {
    ...query,
    month: monthName(start),
    hours: roundHours(minutes),
    billableHours: roundHours(rows.reduce((sum, row) => sum + (row.billableMinutes || 0), 0)),
    byProject: rows
      .map((row) => ({ project: row.project, hours: roundHours(row.totalMinutes || 0), billableHours: roundHours(row.billableMinutes || 0), entries: row.entries || 0 }))
      .sort((a, b) => b.hours - a.hours),
  };
}
