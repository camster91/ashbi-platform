import { afterEach, describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, formatMoney, setFormatLocale } from '../lib/format';

describe('shared formatters', () => {
  afterEach(() => setFormatLocale());

  it('formats dates in one shape and tolerates missing values', () => {
    expect(formatDate('2026-09-27T12:00:00Z')).toBe('Sep 27, 2026');
    expect(formatDate(null)).toBe('');
    expect(formatDate('not a date')).toBe('');
    expect(formatDateTime('2026-09-27T15:04:00')).toMatch(/^Sep 27, 2026, 3:04\s?PM$/);
  });

  it('formats money with grouping, two decimals and the currency symbol', () => {
    expect(formatMoney(10170)).toBe('$10,170.00');
    expect(formatMoney('10170.5')).toBe('$10,170.50');
    expect(formatMoney(10170, 'CAD')).toBe('CA$10,170.00');
    expect(formatMoney(12204, 'USD', { compact: true })).toBe('$12.2K');
    expect(formatMoney(undefined)).toBe('$0.00');
    expect(formatMoney(5, 'not-a-code')).toBe('$5.00');
  });

  it('follows the workspace locale when one is set', () => {
    setFormatLocale('en-CA');
    expect(formatMoney(10170, 'CAD')).toBe('$10,170.00');
  });
});
