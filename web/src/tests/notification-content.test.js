import { describe, expect, it } from 'vitest';
import { resolveNotificationContent } from '../lib/notification-content.js';

describe('notification content', () => {
  it('uses a structured task-update payload instead of rendering JSON', () => {
    expect(resolveNotificationContent({ title: 'Task update', message: '{"title":"Blocked: Test Task 1","message":"Task blocked by UX Judge: No reason given"}' })).toEqual({ title: 'Blocked: Test Task 1', message: 'Task blocked by UX Judge: No reason given' });
  });

  it('retains plain-text and malformed notification messages', () => {
    expect(resolveNotificationContent({ title: 'Update', message: 'Plain text' })).toEqual({ title: 'Update', message: 'Plain text' });
    expect(resolveNotificationContent({ title: 'Update', message: '{not-json}' })).toEqual({ title: 'Update', message: '{not-json}' });
  });
});
