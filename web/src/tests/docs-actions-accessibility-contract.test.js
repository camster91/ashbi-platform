import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Docs.jsx'), 'utf8');

describe('docs actions accessibility contract', () => {
  it('keeps search, type filters, and note form dismissal named and touch-sized', () => {
    expect(source).toContain('type="button"');
    expect(source).toContain('aria-label="Clear note search"');
    expect(source).toContain('aria-label="Close new document form"');
    expect(source).toContain('min-h-11 min-w-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('names project and note expansion controls', () => {
    expect(source).toContain('aria-label={`Toggle project ${project?.name || \'Unlinked\'}`}');
    expect(source).toContain('aria-label={`Toggle note ${note.title}`}');
  });
});
