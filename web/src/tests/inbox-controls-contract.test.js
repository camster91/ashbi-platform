import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Inbox.jsx'), 'utf8');

describe('inbox controls contract', () => {
  it('provides a keyboard-operable priority filter', () => {
    expect(source).toContain('aria-expanded={filterOpen}');
    expect(source).toContain('aria-controls="inbox-filter-menu"');
    expect(source).toContain('role="menuitemradio"');
    expect(source).toContain('setPriorityFilter(value)');
  });

  it('provides a density toggle with accessible state', () => {
    expect(source).toContain('aria-pressed={compactView}');
    expect(source).toContain('setCompactView(value => !value)');
    expect(source).toContain('compact={compactView}');
  });
});
