import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/WPSites.jsx'), 'utf8');

describe('WordPress operations alert accessibility contract', () => {
  it('keeps alert dismissal controls explicit, named, and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-label="Dismiss alert"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('keeps alert dismiss buttons visibly focusable', () => {
    expect(source).toContain('focus-visible:outline-none');
    expect(source).toContain('focus-visible:ring-2');
  });
});
