import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalEstimate.jsx'), 'utf8');

describe('portal estimate actions accessibility contract', () => {
  it('keeps response actions native, touch-sized, and pending-aware', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-busy={respondMutation.isPending}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('labels decline feedback and announces validation and mutation failures', () => {
    expect(source).toContain('htmlFor="estimate-decline-reason"');
    expect(source).toContain('aria-invalid={Boolean(declineError)}');
    expect(source).toContain('id="estimate-decline-reason-error" role="alert"');
    expect(source).toContain('role="status" aria-live="polite"');
  });
});
