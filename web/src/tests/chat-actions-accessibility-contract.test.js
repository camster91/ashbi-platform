import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'src/pages/Chat.jsx'), 'utf8');

describe('chat actions accessibility contract', () => {
  it('keeps conversation selection and suggestions named and touch-sized', () => {
    expect(source).toContain('aria-label={`Open conversation ${c.title}`}');
    expect(source).toContain('aria-label={`Use suggestion: ${s}`}');
    expect(source).toContain('min-h-11');
    expect(source).toContain('focus-visible:ring-2');
  });

  it('keeps chat action buttons explicit', () => {
    expect(source).toContain('type="button"');
  });
});
