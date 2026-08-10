import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/PortalBooking.jsx'), 'utf8');

describe('portal booking actions accessibility contract', () => {
  it('keeps calendar, slot, and submission controls touch-sized and focus-visible', () => {
    expect(source).toContain('aria-label={`Previous month');
    expect(source).toContain('aria-label={`Next month');
    expect(source).toContain('aria-busy={bookMutation.isPending}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('announces booking confirmation and preserves mutation errors', () => {
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('role="alert"');
    expect(source).toContain('bookMutation.isError');
  });
});
