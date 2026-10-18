import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Card } from '../ui';
import QueryErrorState from '../QueryErrorState';
import { emptyClass, panelHeaderClass, panelLinkClass, panelTitleClass } from './clientPageStyles';

// Client page "Time" tab: this month's hours by project (from the page's
// summary request) and the latest entries on the client's most recently
// updated projects (GET /api/projects/:id/time-entries, one per project).
// Rates are never shown here.

export const TIME_TAB_PROJECT_LIMIT = 8;
const ENTRIES_PER_PROJECT = 10;
const RECENT_ENTRY_LIMIT = 20;

function duration(minutes) {
  const value = Number(minutes) || 0;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (hours === 0) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export default function ClientTimeTab({ projects = [], monthHours, isAdmin }) {
  const recentProjects = projects.slice(0, TIME_TAB_PROJECT_LIMIT);
  const entryQueries = useQueries({
    queries: recentProjects.map((project) => ({
      queryKey: ['time-entries', project.id, { limit: ENTRIES_PER_PROJECT }],
      queryFn: () => api.getTimeEntries(project.id, { limit: String(ENTRIES_PER_PROJECT) }),
      retry: false,
    })),
  });
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const loading = entryQueries.some((query) => query.isLoading);
  const failed = entryQueries.find((query) => query.isError);
  const entries = entryQueries
    .flatMap((query) => query.data?.entries || [])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, RECENT_ENTRY_LIMIT);
  const who = isAdmin ? 'Logged' : 'You logged';

  return (
    <div className="space-y-5">
      <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-time-month-heading">
        <div className={panelHeaderClass}>
          <h2 id="client-time-month-heading" className={panelTitleClass}>Hours in {monthHours.month}</h2>
          <Link to="/timesheets" className={panelLinkClass}>Timesheets <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>
        </div>
        {monthHours.isLoading ? (
          <p role="status" className={emptyClass}>Loading hours…</p>
        ) : monthHours.isError ? (
          <div className="px-5 pb-4">
            <QueryErrorState error={monthHours.error} message="Hours could not be loaded" onRetry={() => monthHours.refetch()} isRetrying={monthHours.isFetching} />
          </div>
        ) : monthHours.byProject.length === 0 ? (
          <p className={emptyClass}>{isAdmin ? 'No time logged for this client this month.' : 'You have not logged time for this client this month.'}</p>
        ) : (
          <div className="overflow-x-auto px-5 pb-3">
            <table className="w-full min-w-[420px] text-sm">
              <caption className="sr-only">{who} this month, by project</caption>
              <thead>
                <tr className="text-left">
                  <th scope="col" className="py-2 pr-2 text-eyebrow text-muted-foreground">Project</th>
                  <th scope="col" className="py-2 px-2 text-eyebrow text-muted-foreground text-right">Hours</th>
                  <th scope="col" className="py-2 pl-2 text-eyebrow text-muted-foreground text-right">Billable</th>
                </tr>
              </thead>
              <tbody>
                {monthHours.byProject.map((row) => (
                  <tr key={row.project.id} className="border-t border-border/40">
                    <td className="py-3 pr-2">
                      <Link to={`/project/${row.project.id}`} className="text-foreground underline-offset-4 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring rounded-sm">
                        {row.project.name}
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-right figure">{row.hours} h</td>
                    <td className="py-3 pl-2 text-right figure text-muted-foreground">{row.billableHours} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card as="section" padding="none" className="rounded-lg" aria-labelledby="client-time-recent-heading">
        <div className={panelHeaderClass}>
          <h2 id="client-time-recent-heading" className={panelTitleClass}>Recent time</h2>
          {projects.length > TIME_TAB_PROJECT_LIMIT && (
            <span className="text-xs text-muted-foreground">From the {TIME_TAB_PROJECT_LIMIT} most recently updated projects</span>
          )}
        </div>
        {recentProjects.length === 0 ? (
          <p className={emptyClass}>This client has no projects to log time on yet.</p>
        ) : loading ? (
          <p role="status" className={emptyClass}>Loading time entries…</p>
        ) : failed && entries.length === 0 ? (
          <div className="px-5 pb-4">
            <QueryErrorState error={failed.error} message="Time entries could not be loaded" onRetry={() => entryQueries.forEach((query) => query.isError && query.refetch())} />
          </div>
        ) : entries.length === 0 ? (
          <p className={emptyClass}>No time logged yet.</p>
        ) : (
          <>
            {failed && <p role="alert" className="px-5 pb-2 text-sm text-destructive">Some projects&apos; time could not be loaded.</p>}
            <ul className="px-5 pb-3">
              {entries.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border/40 py-3 first:border-t-0">
                  <span className="min-w-0 flex-[1_1_240px]">
                    <span className="block text-foreground break-words">{entry.description || entry.task?.title || 'No description'}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[formatDate(entry.date), entry.user?.name, projectNames.get(entry.projectId), entry.billable === false ? 'Not billable' : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="figure text-sm text-foreground">{duration(entry.duration)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
