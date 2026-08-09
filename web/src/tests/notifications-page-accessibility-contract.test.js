import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Notifications.jsx'), 'utf8');

describe('notifications page accessibility contract', () => {
  it('keeps notification actions explicit, named, and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-label="Mark notification as read"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('keeps visible focus treatment on notification actions', () => {
    expect(source).toContain('focus-visible:outline-none');
    expect(source).toContain('focus-visible:ring-2');
  });
});
