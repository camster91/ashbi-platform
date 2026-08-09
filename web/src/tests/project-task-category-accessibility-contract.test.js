import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

describe('project task category accessibility contract', () => {
  it('makes the task category disclosure keyboard-operable and named', () => {
    expect(source).toContain('role="button"');
    expect(source).toContain('tabIndex={0}');
    expect(source).toContain('aria-expanded={!isCollapsed}');
    expect(source).toContain('aria-label={`${isCollapsed ? \'Expand\' : \'Collapse\'} ${title} tasks`}');
    expect(source).toContain("e.key === 'Enter' || e.key === ' '");
    expect(source).toContain('focus-visible:ring-2');
  });
});
