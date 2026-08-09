import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/TaskPage.jsx'), 'utf8');

describe('task page accessibility contract', () => {
  it('names and sizes page header controls for keyboard and touch users', () => {
    expect(source).toContain('aria-label="Remove cover image"');
    expect(source).toContain('aria-label="Choose task icon"');
    expect(source).toContain('aria-label={`Choose task icon ${emoji}`}');
    expect(source).toContain('aria-label="Edit task properties"');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('uses native button types for task navigation and subpage actions', () => {
    expect(source).toContain('aria-label="Go back to the previous page"');
    expect(source).toContain('aria-label={`Open subpage ${subpage.title}`}');
    expect(source).toContain('type="button"');
    expect(source).toContain('<Button type="button" size="sm" onClick={onCreateSubpage}');
    expect(source).toContain('<Button type="button" size="sm" variant="outline" onClick={onCreateSubpage}');
  });
});
