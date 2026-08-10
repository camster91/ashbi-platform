import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/components/ui/Button.jsx'), 'utf8');

describe('shared button interaction contract', () => {
  it('keeps the default control touch-sized and keyboard-visible', () => {
    expect(source).toContain("md: 'min-h-11 px-4 text-sm'");
    expect(source).toContain('focus-visible:outline-none focus-visible:ring-4');
  });

  it('keeps loading state observable and motion-safe', () => {
    expect(source).toContain('aria-busy={showLoading || undefined}');
    expect(source).toContain('animate-spin motion-reduce:animate-none');
  });
});
