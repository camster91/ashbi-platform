import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Estimates.jsx'), 'utf8');

describe('estimate actions accessibility contract', () => {
  it('keeps estimate filters explicit and keyboard-visible', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-pressed={filterStatus === s}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('names both line-item removal and add-item actions', () => {
    expect(source).toContain('aria-label={`Remove estimate line item ${idx + 1}`');
    expect(source).toContain('aria-label="Add estimate line item"');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
