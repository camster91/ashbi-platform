import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/AiContextSettings.jsx'), 'utf8');

describe('AI context settings actions accessibility contract', () => {
  it('keeps add, save, and cancel actions native, touch-sized, and focus-visible', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('Close new context form');
  });

  it('names edit and delete actions for the affected context entry', () => {
    expect(source).toContain('aria-label={`Edit AI context ${item.key}`}');
    expect(source).toContain('aria-label={`Delete AI context ${item.key}`}');
  });
});
