import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';

const keyOf = date => date.toISOString().slice(0, 10);
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function taskCalendarDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? keyOf(date) : null;
}
export function calendarMonth(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { first, padding: first.getUTCDay(), days: Array.from({ length: days }, (_, index) => keyOf(new Date(Date.UTC(year, month, index + 1)))) };
}
function TaskList({ tasks }) {
  return <ul className="space-y-1">{tasks.map(task => <li key={task.id}><Link to={`/task/${task.id}`} className="block min-h-11 rounded border border-border bg-card p-2 text-sm text-primary break-words">{task.title}</Link></li>)}</ul>;
}
export default function TaskViewCalendar({ tasks }) {
  // Task due dates use calendar-date display elsewhere in the app. Use UTC
  // throughout so midnight dates do not move a day for viewers west of UTC.
  const today = keyOf(new Date());
  const [cursor, setCursor] = useState(() => today.slice(0, 7));
  const [year, month] = cursor.split('-').map(Number);
  const calendar = calendarMonth(year, month - 1);
  const dated = {};
  const undated = [];
  for (const task of tasks) {
    const date = taskCalendarDate(task.dueDate);
    if (date) (dated[date] ??= []).push(task); else undated.push(task);
  }
  const visibleCount = calendar.days.reduce((count, date) => count + (dated[date]?.length ?? 0), 0);
  const outsideCount = tasks.length - undated.length - visibleCount;
  const heading = formatDate(calendar.first, { dateOnly: true, month: 'long', day: undefined });
  function move(offset) {
    setCursor(keyOf(new Date(Date.UTC(year, month - 1 + offset, 1))).slice(0, 7));
  }
  return <section aria-label="Task calendar" className="space-y-3">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-heading text-xl font-semibold" aria-live="polite">{heading}</h2>
      <button type="button" className="min-h-11 rounded border border-border px-3 disabled:opacity-50" disabled={cursor === '1000-01'} onClick={() => move(-1)} aria-label="Previous month">Previous</button>
      <button type="button" className="min-h-11 rounded border border-border px-3" onClick={() => setCursor(today.slice(0, 7))}>This month</button>
      <button type="button" className="min-h-11 rounded border border-border px-3 disabled:opacity-50" disabled={cursor === '9999-12'} onClick={() => move(1)} aria-label="Next month">Next</button>
      <label className="text-sm">Month<input type="month" aria-label="Calendar month" value={cursor} min="1000-01" max="9999-12" className="ml-2 min-h-11 rounded border border-border bg-card px-3"
        onChange={event => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) setCursor(event.target.value); }} /></label>
    </div>
    <p role="status" className="text-sm text-muted-foreground">{visibleCount} tasks this month. {outsideCount} dated tasks in other months. Change month to see them.</p>
    <p className="text-sm text-muted-foreground">Due dates are calendar dates. Open a task to change its due date.</p>
    <div className="hidden md:grid grid-cols-7 gap-2" aria-hidden="true">{weekdays.map(day => <span key={day} className="text-sm font-semibold">{day.slice(0, 3)}</span>)}</div>
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {Array.from({ length: calendar.padding }, (_, index) => <div key={`empty-${index}`} className="hidden md:block" aria-hidden="true" />)}
      {calendar.days.map(date => <section key={date} aria-label={formatDate(date, { dateOnly: true, weekday: 'long' })} className={`min-w-0 rounded border border-border p-2 md:min-h-28 ${date === today ? 'ring-2 ring-primary' : ''}`}>
        <h3 className="mb-2 text-sm font-semibold"><time dateTime={date}><span className="md:hidden">{formatDate(date, { dateOnly: true, weekday: 'short' })}</span><span className="hidden md:inline">{Number(date.slice(-2))}</span></time></h3>
        {dated[date]?.length ? <TaskList tasks={dated[date]} /> : <p className="text-xs text-muted-foreground md:sr-only">No tasks due</p>}
      </section>)}
    </div>
    <section aria-label="Tasks without due dates" className="rounded border border-border p-3">
      <h2 className="mb-2 font-semibold">No due date ({undated.length})</h2>
      {undated.length ? <TaskList tasks={undated} /> : <p className="text-sm text-muted-foreground">All matching tasks have a due date.</p>}
    </section>
  </section>;
}
