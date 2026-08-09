import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schedule = readFileSync(resolve(process.cwd(), 'src/pages/Schedule.jsx'), 'utf8');

describe('schedule workflow states', () => {
  it('makes calendar and upcoming-event failures visible and retryable', () => {
    expect(schedule).toContain("import QueryErrorState from '../components/QueryErrorState';");
    for (const token of [
      'calendarError',
      'refetchCalendar',
      'upcomingError',
      'refetchUpcoming',
    ]) {
      expect(schedule).toContain(token);
    }
    expect(schedule.match(/<QueryErrorState/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('makes project and teammate form dependencies jointly recoverable', () => {
    for (const token of [
      'projectsError',
      'teamError',
      'eventFormDataError',
      'retryEventFormData',
      'eventFormDataFetching',
    ]) {
      expect(schedule).toContain(token);
    }
    expect(schedule).toMatch(/function EventModal\([\s\S]*eventFormDataError[\s\S]*<QueryErrorState/);
  });
});
