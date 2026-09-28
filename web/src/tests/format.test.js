import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, setFormatLocale } from '../lib/format';

describe('shared formatters', () => {
  afterEach(() => setFormatLocale());

  it('formats dates in one shape and tolerates missing values', () => {
    expect(formatDate('2026-09-27T12:00:00Z')).toBe('Sep 27, 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatDateTime('2026-09-27T15:04:00')).toMatch(/^Sep 27, 2026, 3:04\s?p\.m\.$/);
  });

  it('formats date-only values in UTC so they never shift to the previous day', () => {
    const midnightUtc = '2026-11-06T00:00:00.000Z';
    expect(formatDate(midnightUtc, { dateOnly: true })).toBe('Nov 6, 2026');
    expect(formatDate(midnightUtc, { dateOnly: true, timeZone: 'UTC' })).toBe('Nov 6, 2026');
    // Without dateOnly a viewer west of UTC sees the local calendar day.
    expect(formatDate(midnightUtc, { timeZone: 'America/Vancouver' })).toBe('Nov 5, 2026');
  });

  it('formats money with grouping, two decimals and a CAD default', () => {
    expect(formatMoney(10170)).toBe('$10,170.00');
    expect(formatMoney('10170.5', 'CAD')).toBe('$10,170.50');
    expect(formatMoney(10170, 'USD')).toBe('US$10,170.00');
    expect(formatMoney(12204, undefined, { compact: true })).toBe('$12.2K');
    expect(formatMoney(undefined)).toBe('$0.00');
    expect(formatMoney(5, 'not-a-code')).toBe('$5.00');
  });

  it('follows the workspace locale when one is set', () => {
    setFormatLocale('en-US');
    expect(formatMoney(10170, 'USD')).toBe('$10,170.00');
    expect(formatMoney(10170, 'CAD')).toBe('CA$10,170.00');
  });
});
