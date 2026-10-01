import { describe, expect, it } from 'vitest';
import { calendarDaysUntil, todayDateInputValue } from '../lib/format';

// Date-only values (expense dates, milestone due dates) are stored as a UTC
// calendar day; these helpers keep them on the chosen day in any timezone.
describe('date-only helpers', () => {
  it('defaults a date input to the local calendar date', () => {
    // 11pm local on Sep 30: toISOString would give Oct 1 west of UTC.
    expect(todayDateInputValue(new Date(2026, 8, 30, 23, 30))).toBe('2026-09-30');
    expect(todayDateInputValue(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });

  it('counts calendar days to a UTC date from the local today', () => {
    const lateEvening = new Date(2026, 9, 14, 22, 0);
    expect(calendarDaysUntil('2026-10-15T00:00:00.000Z', lateEvening)).toBe(1);
    expect(calendarDaysUntil('2026-10-14T00:00:00.000Z', lateEvening)).toBe(0);
    expect(calendarDaysUntil('2026-10-13T00:00:00.000Z', new Date(2026, 9, 14, 0, 5))).toBe(-1);
    expect(calendarDaysUntil(null)).toBe(null);
  });
});
