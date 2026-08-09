import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { preferredScrollBehavior, prefersReducedMotion } from '../lib/motion';

describe('reduced-motion policy', () => {
  it('uses immediate scrolling when the OS requests reduced motion', () => {
    const reduced = vi.fn(() => ({ matches: true }));
    const normal = vi.fn(() => ({ matches: false }));
    expect(prefersReducedMotion(reduced)).toBe(true);
    expect(preferredScrollBehavior(reduced)).toBe('auto');
    expect(preferredScrollBehavior(normal)).toBe('smooth');
  });

  it('globally disables nonessential animation, transforms, transitions, and smooth scrolling', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('animation-iteration-count: 1 !important');
    expect(css).toContain('transition-duration: 0.01ms !important');
    expect(css).toContain('scroll-behavior: auto !important');
    expect(css).toContain('transform: none !important');
  });
});
