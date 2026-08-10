import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Pipeline.jsx'), 'utf8');

describe('pipeline actions accessibility contract', () => {
  it('names and sizes deal action popovers', () => {
    expect(source).toContain('aria-label={`Move ${deal.name} to another stage`}');
    expect(source).toContain('aria-label={`Show AI lead score for ${deal.name}`}');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('exposes expanded state for desktop and mobile stage controls', () => {
    expect(source).toContain('aria-label={`${isExpanded ? \'Collapse\' : \'Expand\'} ${stage.label} stage`}');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('focus-visible:ring-2');
  });
});
