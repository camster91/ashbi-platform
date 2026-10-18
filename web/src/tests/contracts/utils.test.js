/**
 * Frontend Utility Unit Tests
 */
import { describe, it, expect, vi } from 'vitest';
import { 
  cn, 
  formatDate, 
  formatDateTime, 
  formatRelativeTime, 
  truncate,
  getPriorityColor,
  getHealthColor,
  getStatusColor,
  getProjectStatusColor,
  getProjectStatusLabel,
  getSentimentIcon
} from '../../lib/utils.js';

describe('Frontend Utils', () => {
  describe('cn', () => {
    it('merges tailwind classes correctly', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2');
      expect(cn('text-red-500', 'bg-blue-500', 'text-white')).toContain('text-white');
    });

    it('resolves Tailwind 4 utility conflicts using the final class', () => {
      expect(cn('shadow-xs', 'shadow-sm')).toBe('shadow-sm');
      expect(cn('outline-hidden', 'outline-none')).toBe('outline-none');
      expect(cn('bg-linear-to-r', 'bg-linear-to-b')).toBe('bg-linear-to-b');
      expect(cn('shrink-0', 'shrink')).toBe('shrink');
      expect(cn('rounded-sm', 'rounded-md')).toBe('rounded-md');
    });

    it('preserves independent brand tokens while resolving conflicts within each utility', () => {
      expect(cn('bg-background text-foreground ring-ring', 'bg-primary text-primary-foreground ring-info'))
        .toBe('bg-primary text-primary-foreground ring-info');
    });
  });

  describe('formatDate', () => {
    it('returns empty string for null/undefined', () => {
      expect(formatDate(null)).toBe('');
      expect(formatDate(undefined)).toBe('');
    });

    it('formats date correctly', () => {
      const date = new Date('2026-05-04T12:00:00Z');
      const result = formatDate(date);
      expect(result).toContain('May 4');
    });
  });

  describe('formatDateTime', () => {
    it('formats datetime correctly', () => {
      const date = new Date('2026-05-04T15:30:00Z');
      const result = formatDateTime(date);
      expect(result).toContain('May 4');
      // Time format depends on locale, but checking for minutes
      expect(result).toContain('30');
    });
  });

  describe('formatRelativeTime', () => {
    it('returns "Just now" for current time', () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe('Just now');
    });

    it('returns minutes ago', () => {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60000);
      expect(formatRelativeTime(fiveMinsAgo)).toBe('5m ago');
    });

    it('returns hours ago', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('2h ago');
    });

    it('returns days ago', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
      expect(formatRelativeTime(threeDaysAgo)).toBe('3d ago');
    });
  });

  describe('truncate', () => {
    it('truncates long strings', () => {
      const str = 'This is a very long string that should be truncated';
      expect(truncate(str, 10)).toBe('This is a ...');
    });

    it('returns original string if short enough', () => {
      const str = 'Short';
      expect(truncate(str, 10)).toBe('Short');
    });
  });

  describe('Color Helpers', () => {
    it('getPriorityColor returns token classes from the shared status map', () => {
      expect(getPriorityColor('CRITICAL')).toContain('text-destructive');
      expect(getPriorityColor('LOW')).toContain('text-muted-foreground');
      expect(getPriorityColor('UNKNOWN')).toContain('text-muted-foreground');
    });

    it('getHealthColor returns token classes', () => {
      expect(getHealthColor('ON_TRACK')).toContain('text-success');
      expect(getHealthColor('AT_RISK')).toContain('text-destructive');
    });

    it('getProjectStatusColor returns token classes', () => {
      expect(getProjectStatusColor('LAUNCHED')).toContain('text-success');
      expect(getProjectStatusColor('CANCELLED')).toContain('text-destructive');
    });
  });

  describe('getProjectStatusLabel', () => {
    it('returns human readable labels', () => {
      expect(getProjectStatusLabel('STARTING_UP')).toBe('Starting Up');
      expect(getProjectStatusLabel('DESIGN_DEV')).toBe('Design & Dev');
      expect(getProjectStatusLabel('CUSTOM_STATUS')).toBe('CUSTOM STATUS');
    });
  });

  describe('getSentimentIcon', () => {
    it('returns correct emojis', () => {
      expect(getSentimentIcon('happy')).toBe('😊');
      expect(getSentimentIcon('frustrated')).toBe('😤');
      expect(getSentimentIcon('unknown')).toBe('😐');
    });
  });
});
