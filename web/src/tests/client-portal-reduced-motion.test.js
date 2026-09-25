import { describe, expect, it } from 'vitest';
import '../pages/ClientPortal';

function portalCss() {
  const style = document.getElementById('cp-styles');
  expect(style).not.toBeNull();
  return style.textContent;
}

function reducedMotionBlock(css) {
  const start = css.indexOf('@media (prefers-reduced-motion: reduce)');
  expect(start).toBeGreaterThan(-1);
  // Walk braces to capture the whole media block.
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') depth -= 1;
    if (depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('unterminated reduced-motion block');
}

describe('client portal reduced motion (#318)', () => {
  it('neutralises every hover transform declared by the portal styles', () => {
    const css = portalCss();
    const reduced = reducedMotionBlock(css);
    const outside = css.replace(reduced, '');
    const moving = [...outside.matchAll(/([^{}]+)\{[^}]*transform:\s*(?:translate|scale|rotate)[^}]*\}/g)]
      .flatMap((match) => match[1].split(','))
      .map((selector) => selector.trim())
      .filter(Boolean);

    expect(moving.length).toBeGreaterThan(0);
    for (const selector of moving) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toMatch(/transform:\s*none !important/);
  });

  it('disables portal transitions and animations under reduced motion', () => {
    const reduced = reducedMotionBlock(portalCss());
    expect(reduced).toContain('animation: none !important;');
    expect(reduced).toContain('transition-duration: 0.01ms !important;');
    expect(reduced).toContain('transition-delay: 0ms !important;');
  });
});
