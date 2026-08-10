import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalContract.jsx'), 'utf8');

describe('portal contract signing accessibility contract', () => {
  it('keeps signature mode and clear controls touch-sized and focus-visible', () => {
    expect(source).toContain('aria-label="Clear drawn signature"');
    expect(source).toContain('aria-pressed={signatureMode ===');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('exposes pending state for the legally consequential sign action', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-busy={signMutation.isPending}');
    expect(source).toContain('<p role="alert"');
    expect(source).toContain('role="status" aria-live="polite"');
  });
});
