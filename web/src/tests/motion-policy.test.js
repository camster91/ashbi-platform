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
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\r\n/g, '\n');
    const reducedMotion = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
      css.indexOf('/* Scrollbar styling */')
    );

    expect(reducedMotion).toContain('*,\n  *::before,\n  *::after');
    expect(reducedMotion).toContain('animation: none !important;');
    expect(reducedMotion).not.toContain('animation-iteration-count');
    expect(reducedMotion).not.toContain('animation-duration');
    expect(reducedMotion).toContain('transition-duration: 0.01ms !important;');
    expect(reducedMotion).toContain('scroll-behavior: auto !important;');
    expect(reducedMotion).toContain('transform: none !important;');
    expect(reducedMotion).toMatch(
      /\.animate-fade-in,\s*\.animate-slide-up,\s*\.animate-scale-in\s*{[^}]*opacity:\s*1;[^}]*transform:\s*none;/s
    );
  });
});
