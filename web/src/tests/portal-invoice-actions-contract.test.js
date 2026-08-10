import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalInvoice.jsx'), 'utf8');

describe('portal invoice payment accessibility contract', () => {
  it('keeps payment initiation native, touch-sized, and pending-aware', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-busy={payMutation.isPending}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('announces paid status and payment failures', () => {
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('<p role="alert"');
  });
});
