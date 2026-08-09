import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('layout shell accessibility contract', () => {
  it('names and exposes collapsible navigation state', () => {
    expect(source).toContain('aria-expanded={show}');
    expect(source).toContain('aria-label={`${show ? \'Collapse\' : \'Expand\'} ${label}`}');
    expect(source).toContain('type="button"');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps header and mobile controls named and touch-sized', () => {
    expect(source).toContain('aria-label={isDark ? \'Switch to light mode\' : \'Switch to dark mode\'}');
    expect(source).toContain('aria-label="Open more navigation options"');
    expect(source).toContain('aria-label="Dismiss install banner"');
  });

  it('makes quick-create controls named, native, and keyboard-visible', () => {
    expect(source).toContain('aria-label="Open quick create menu"');
    expect(source).toContain('aria-label={label}');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('focus-visible:ring-2');
  });
});
