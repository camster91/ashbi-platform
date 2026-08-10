import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/Calendar.jsx'), 'utf8');

describe('calendar toolbar accessibility contract', () => {
  it('names and sizes calendar navigation actions', () => {
    expect(source).toContain('aria-label="Go to today"');
    expect(source).toContain('aria-label="Previous month"');
    expect(source).toContain('aria-label="Next month"');
    expect(source).toContain('aria-label="New Event (create calendar event)"');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps toolbar controls explicit buttons', () => {
    expect(source).toContain('type="button"');
  });
});
