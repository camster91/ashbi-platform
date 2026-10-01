import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Pipeline.jsx'), 'utf8');

describe('pipeline actions accessibility contract', () => {
  it('names and sizes deal action popovers', () => {
    expect(source).toContain('aria-label={`Move ${deal.title} to another stage`}');
    expect(source).toContain('aria-label={`Show AI lead score for ${deal.title}`}');
    expect(source).toContain('role="menuitem"');
    expect(source).toContain('min-h-11 min-w-11');
  });

  it('keeps deal row actions visible while one of them has keyboard focus', () => {
    expect(source).toContain('group-focus-within:opacity-100');
    expect(source).toContain('aria-label={`Delete ${deal.title}`}');
  });

  it('exposes expanded state for desktop and mobile stage controls', () => {
    expect(source).toContain('aria-label={`${isExpanded ? \'Collapse\' : \'Expand\'} ${stage.name} stage`}');
    expect(source).toContain('aria-expanded={isExpanded}');
    expect(source).toContain('focus-visible:ring-2');
  });
});
