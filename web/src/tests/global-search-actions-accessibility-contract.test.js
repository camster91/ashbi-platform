import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/GlobalSearch.jsx'), 'utf8');

describe('global search actions accessibility contract', () => {
  it('keeps filters explicit, keyboard-visible, and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-pressed={filter === f.value}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('gives each search result a descriptive accessible name', () => {
    expect(source).toContain('aria-label={`Open ${result.type}');
    expect(source).toContain('w-full min-h-11');
  });
});
