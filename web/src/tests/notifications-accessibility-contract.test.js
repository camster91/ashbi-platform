import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/NotificationsDropdown.jsx'), 'utf8');

describe('notifications accessibility contract', () => {
  it('keeps notification actions native, named, and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-label={`Notifications');
    expect(source).toContain('aria-label="Mark as read"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('keeps notification rows keyboard operable without nested interactive controls', () => {
    expect(source).toContain('role="button"');
    expect(source).toContain('onKeyDown={(event) => {');
    expect(source).not.toContain('<button\n                        onClick={() => handleNotificationClick(notification)}');
  });
});
