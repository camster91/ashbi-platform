import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const retainers = readFileSync(resolve(process.cwd(), 'src/pages/Retainers.jsx'), 'utf8');
const expenses = readFileSync(resolve(process.cwd(), 'src/pages/Expenses.jsx'), 'utf8');

describe('retainers and expenses accessibility contract', () => {
  it('keeps retainer controls explicit, named, and focus-visible', () => {
    expect(retainers).toContain('aria-label="Close retainer form"');
    expect(retainers).toContain('aria-label="Generate monthly invoice"');
    expect(retainers).toContain('aria-label={`Edit retainer');
    expect(retainers).toContain('min-h-11 min-w-11');
    expect(retainers).toContain('focus-visible:ring-2');
  });

  it('keeps expense filter and form controls keyboard-safe', () => {
    expect(expenses).toContain('aria-label="Clear expense filters"');
    expect(expenses).toContain('aria-label="Close expense form"');
    expect(expenses).toContain('type="button"');
    expect(expenses).toContain('focus-visible:outline-none');
  });
});
