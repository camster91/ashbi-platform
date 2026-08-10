import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalIntakeForm.jsx'), 'utf8');

describe('public intake action contract', () => {
  it('keeps submit state observable and touch-friendly', () => {
    expect(source).toContain('aria-busy={submitMutation.isPending}');
    expect(source).toContain('disabled={submitMutation.isPending}');
    expect(source).toContain('w-full min-h-11 py-3 px-4');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('preserves validation and recovery announcements', () => {
    expect(source).toContain('role="alert"');
    expect(source).toContain('requestAnimationFrame(() => summaryRef.current?.focus())');
    expect(source).toContain("submitMutation.error?.message || 'Failed to submit. Please try again.'");
  });
});
