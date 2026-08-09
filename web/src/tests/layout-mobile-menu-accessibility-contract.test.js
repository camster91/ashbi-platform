import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('layout mobile menu accessibility contract', () => {
  it('keeps More-menu theme and logout actions native and focus-visible', () => {
    expect(source).toContain('aria-label="Change theme"');
    expect(source).toContain('aria-label="Log out"');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps mobile navigation and menu links at the touch-target minimum', () => {
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:outline-none');
  });
});
