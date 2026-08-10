import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Invoices.jsx'), 'utf8');

describe('invoice line-item actions accessibility contract', () => {
  it('keeps template and add-item actions explicit and focus-visible', () => {
    expect(source).toContain('aria-label={`Apply invoice template');
    expect(source).toContain('aria-label="Add invoice line item"');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('min-h-11');
  });

  it('names both desktop and mobile line-item removal controls', () => {
    expect(source).toContain('aria-label={`Remove line item ${idx + 1}`');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
