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
} from '../lib/utils';

describe('Frontend Utils', () => {
  describe('cn', () => {
    it('merges tailwind classes correctly', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2');
      expect(cn('text-red-500', 'bg-blue-500', 'text-white')).toContain('text-white');
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
    it('getPriorityColor returns correct classes', () => {
      expect(getPriorityColor('CRITICAL')).toContain('text-red-600');
      expect(getPriorityColor('LOW')).toContain('text-gray-600');
      expect(getPriorityColor('UNKNOWN')).toContain('text-gray-600');
    });

    it('getHealthColor returns correct classes', () => {
      expect(getHealthColor('ON_TRACK')).toContain('text-green-600');
      expect(getHealthColor('AT_RISK')).toContain('text-red-600');
    });

    it('getProjectStatusColor returns correct classes', () => {
      expect(getProjectStatusColor('LAUNCHED')).toContain('text-green-600');
      expect(getProjectStatusColor('CANCELLED')).toContain('text-red-600');
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
