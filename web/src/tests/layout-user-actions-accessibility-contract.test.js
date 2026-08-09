import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('layout user actions accessibility contract', () => {
  it('keeps collapsed and expanded logout controls native, named, and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-label="Logout"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('keeps settings links keyboard-visible and touch-sized', () => {
    expect(source).toContain('aria-label="Settings"');
    expect(source).toContain('focus-visible:ring-2');
  });
});
