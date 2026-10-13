import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import TaskViewCalendar, { calendarMonth, taskCalendarDate } from '../components/TaskViewCalendar';

const rows = [
  { id: 'leap', title: 'Leap-day review', dueDate: '2028-02-29T00:00:00Z' },
  { id: 'march', title: 'March brief', dueDate: '2028-03-01T00:00:00Z' },
  { id: 'none', title: 'Undated task', dueDate: null },
];
function setup(tasks = rows) {
  render(<MemoryRouter><TaskViewCalendar tasks={tasks} /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '2028-02' } });
}
describe('task calendar', () => {
  it('uses stored UTC dates rather than shifting midnight dates west of UTC', () => {
    expect(taskCalendarDate('2028-02-29T00:00:00Z')).toBe('2028-02-29');
    expect(taskCalendarDate('2028-03-01T00:30:00+01:00')).toBe('2028-02-29');
    expect(taskCalendarDate('invalid')).toBeNull();
    expect(taskCalendarDate(null)).toBeNull();
  });
  it('includes leap day and crosses year/month boundaries without losing the first day', () => {
    expect(calendarMonth(2028, 1).days).toHaveLength(29);
    expect(calendarMonth(2027, 1).days).toHaveLength(28);
    expect(calendarMonth(2028, 12).days[0]).toBe('2029-01-01');
  });
  it('shows month tasks, exposes undated work and reports records in other months', () => {
    setup();
    const day = screen.getByRole('region', { name: /Tuesday, Feb 29, 2028/ });
    expect(within(day).getByRole('link', { name: 'Leap-day review' })).toHaveAttribute('href', '/task/leap');
    expect(screen.queryByText('March brief')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tasks without due dates' })).getByText('Undated task')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('1 tasks this month. 1 dated tasks in other months.');
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { name: 'March 2028' })).toBeInTheDocument();
    expect(screen.getByText('March brief')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByText('Leap-day review')).toBeInTheDocument();
  });
  it('retains navigation with an empty filtered month and limits date arithmetic', () => {
    setup([]);
    expect(screen.getByRole('status')).toHaveTextContent('0 tasks this month');
    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '9999-12' } });
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Calendar month'), { target: { value: '1000-01' } });
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByLabelText('Calendar month')).toHaveValue(new Date().toISOString().slice(0, 7));
  });
});
