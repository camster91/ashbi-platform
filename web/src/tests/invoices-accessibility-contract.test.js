import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');

describe('invoices accessibility contract', () => {
  it('keeps tabs and status filters native and state-announced', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-selected={activeTab === tab}');
    expect(source).toContain('aria-pressed={filterStatus === s}');
    expect(source).toContain('type="button"');
  });

  it('keeps invoice row actions named, focused, and touch-sized', () => {
    expect(source).toContain('aria-label="View invoice"');
    expect(source).toContain('aria-label="Void invoice"');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('focus-visible:ring-2');
  });
});
