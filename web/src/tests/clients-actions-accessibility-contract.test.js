import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Clients.jsx'), 'utf8');

describe('clients actions accessibility contract', () => {
  it('keeps client toolbar and onboarding controls explicit and focused', () => {
    expect(source).toContain('aria-label="Toggle client health"');
    expect(source).toContain('aria-label="Close client onboarding"');
    expect(source).toContain('type="button"');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps client health and expansion actions named and touch-sized', () => {
    expect(source).toContain('aria-label={`Open client health for');
    expect(source).toContain('aria-label={`${isExpanded ?');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
