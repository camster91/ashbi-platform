import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../../lib/format';
import { calendarMonth, taskCalendarDate } from '../TaskViewCalendar';
import { dueState } from './projectBoard';
import { cn } from '../../lib/utils';

// Projects by due date (the Calendar view on the Projects page). Due dates are
// calendar dates, so the grid works in UTC like the task calendar.
const keyOf = (date) => date.toISOString().slice(0, 10);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ProjectLinks({ projects }) {
  return (
    <ul className="space-y-1">
      {projects.map((project) => {
        const due = dueState(project);
        return (
          <li key={project.id}>
            <Link
              to={`/project/${project.id}`}
              className={cn(
                'block min-h-11 rounded-md border bg-card px-2 py-1.5 text-xs break-words focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                due === 'overdue' ? 'border-destructive/40 text-destructive' : 'border-border/60 text-foreground',
              )}
            >
              <span className="block font-semibold">{project.name}</span>
              {project.client?.name && <span className="block text-muted-foreground">{project.client.name}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function ProjectCalendarView({ projects }) {
  const today = keyOf(new Date());
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const [year, month] = cursor.split('-').map(Number);
  const calendar = calendarMonth(year, month - 1);
  const dated = {};
  const undated = [];
  for (const project of projects) {
    const date = taskCalendarDate(project.endDate);
    if (date) (dated[date] ??= []).push(project); else undated.push(project);
  }
  const visibleCount = calendar.days.reduce((count, date) => count + (dated[date]?.length ?? 0), 0);
  const heading = formatDate(calendar.first, { dateOnly: true, month: 'long', day: undefined });
  const move = (offset) => setCursor(keyOf(new Date(Date.UTC(year, month - 1 + offset, 1))).slice(0, 7));
  const navButton = 'min-h-11 rounded-md border border-border/60 bg-card px-3 font-mono text-xs uppercase tracking-[0.1em] text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <section aria-labelledby="project-calendar-heading" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="project-calendar-heading" className="mr-2 text-xl font-semibold tracking-tight text-foreground" aria-live="polite">{heading}</h2>
        <button type="button" className={navButton} onClick={() => move(-1)} aria-label="Previous month">Prev</button>
        <button type="button" className={navButton} onClick={() => setCursor(today.slice(0, 7))}>This month</button>
        <button type="button" className={navButton} onClick={() => move(1)} aria-label="Next month">Next</button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {visibleCount} {visibleCount === 1 ? 'project' : 'projects'} due this month.
      </p>
      <div className="hidden md:grid grid-cols-7 gap-2" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day} className="text-eyebrow text-muted-foreground">{day}</span>)}
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-7">
        {Array.from({ length: calendar.padding }, (_, index) => <li key={`pad-${index}`} className="hidden md:block" aria-hidden="true" />)}
        {calendar.days.map((date) => {
          const items = dated[date] ?? [];
          return (
            <li
              key={date}
              className={cn('min-w-0 rounded-lg bg-muted/50 p-2 md:min-h-24', date === today && 'ring-2 ring-primary', items.length === 0 && 'max-md:hidden')}
            >
              <time dateTime={date} className="mb-1 block text-xs font-semibold text-muted-foreground">
                <span className="sr-only">{formatDate(date, { dateOnly: true, weekday: 'long' })}</span>
                <span aria-hidden="true" className="md:hidden">{formatDate(date, { dateOnly: true, weekday: 'short' })}</span>
                <span aria-hidden="true" className="hidden md:inline">{Number(date.slice(-2))}</span>
              </time>
              {items.length > 0 && <ProjectLinks projects={items} />}
            </li>
          );
        })}
      </ol>
      <section aria-labelledby="project-calendar-undated" className="rounded-lg border border-border/60 bg-card p-3">
        <h3 id="project-calendar-undated" className="mb-2 font-semibold text-foreground">No due date ({undated.length})</h3>
        {undated.length > 0 ? <ProjectLinks projects={undated} /> : <p className="text-sm text-muted-foreground">Every project here has a due date.</p>}
      </section>
    </section>
  );
}
