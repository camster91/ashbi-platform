import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Project.jsx'), 'utf8');

describe('project actions accessibility contract', () => {
  it('keeps project toolbar actions explicit and focus-visible', () => {
    expect(source).toContain('aria-label="Share project with client"');
    expect(source).toContain('aria-label="Apply project template"');
    expect(source).toContain('aria-label="Draft project update"');
    expect(source).toContain('type="button"');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps revision and notes actions named and touch-sized', () => {
    expect(source).toContain('aria-label="New revision round"');
    expect(source).toContain('aria-label={`Approve revision');
    expect(source).toContain('aria-label="Create new note"');
    expect(source).toContain('min-h-11 min-w-11');
  });
});
