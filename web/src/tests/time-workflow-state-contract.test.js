import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const timesheets = readFileSync(resolve(process.cwd(), 'src/pages/Timesheets.jsx'), 'utf8');
const tracking = readFileSync(resolve(process.cwd(), 'src/pages/TimeTracking.jsx'), 'utf8');

describe('time workflow states', () => {
  it('distinguishes a weekly timesheet failure from a zero-hour week', () => {
    expect(timesheets).toContain("import QueryErrorState from '../components/QueryErrorState';");
    expect(timesheets).toContain('timesheetsError');
    expect(timesheets).toContain('refetchTimesheets');
    expect(timesheets).toMatch(/timesheetsError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*timesheets\.length === 0/);
  });

  it('keeps time-entry and project-context failures visible and retryable', () => {
    expect(tracking).toContain("import QueryErrorState from '../components/QueryErrorState';");
    for (const token of ['entriesError', 'refetchEntries', 'projectError', 'refetchProject']) {
      expect(tracking).toContain(token);
    }
    expect(tracking).toMatch(/entriesError\s*\?\s*\([\s\S]*<QueryErrorState[\s\S]*entries\.length === 0/);
  });
});
