import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');

describe('invoices accessibility contract', () => {
  it('keeps tabs and status filters native and state-announced', () => {
    // The views use the Tabs primitive (tablist/tab/tabpanel roles, arrow keys).
    expect(source).toContain('<Tabs value={activeTab} onValueChange={setActiveTab}');
    expect(source).toContain('<TabList aria-label="Invoice views">');
    expect(source).toContain('<TabPanel value="list"');
    expect(source).toContain('<TabPanel value="collections"');
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
