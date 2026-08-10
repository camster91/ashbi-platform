import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Settings.jsx'), 'utf8');

describe('admin navigation contract', () => {
  it('does not expose a dead reports route before the finance decision', () => {
    expect(source).not.toContain("href: '/reports'");
    expect(source).toContain("label: 'Reports (planned)'");
    expect(source).toContain('aria-disabled="true"');
  });

  it('keeps available admin links keyboard-visible and touch-sized', () => {
    expect(source).toContain('min-h-11 p-3 rounded-lg');
    expect(source).toContain('focus-visible:ring-2 focus-visible:ring-ring');
  });
});
