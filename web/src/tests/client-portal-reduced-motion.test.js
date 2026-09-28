import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clientPortalCss, clientPortalSource } from './helpers/clientPortalSource';

// The portal's own stylesheet now holds only portal-specific layout (#316);
// its controls are shared primitives covered by the global motion contract.
function portalCss() {
  const css = clientPortalCss();
  expect(css).toContain('.cp-upload-zone');
  return css;
}

function reducedMotionBlock(css, marker = '@media (prefers-reduced-motion: reduce)') {
  const start = css.indexOf(marker);
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
  it('declares no hover transforms in the portal stylesheet', () => {
    const css = portalCss();
    const outside = css.replace(reducedMotionBlock(css), '');
    expect(outside).not.toMatch(/transform:\s*(?:translate|scale|rotate)/);
  });

  it('disables portal transitions and animations under reduced motion', () => {
    const reduced = reducedMotionBlock(portalCss());
    expect(reduced).toContain('animation: none !important;');
    expect(reduced).toContain('transition-duration: 0.01ms !important;');
    expect(reduced).toContain('transition-delay: 0ms !important;');
  });

  it('relies on the global contract for the hover motion of the primitives it uses', () => {
    const source = clientPortalSource();
    // Interactive cards (hover-lift) and StatCard (hover:-translate-y-1).
    expect(source).toContain('isInteractive');
    expect(source).toContain('<StatCard');
    const indexCss = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const reduced = reducedMotionBlock(indexCss);
    expect(reduced).toContain('.hover-lift:hover');
    expect(reduced).toContain("[class*='hover:-translate-']:hover");
    expect(reduced).toMatch(/transform:\s*none !important/);
  });

  it('keeps progress bars from animating under reduced motion', () => {
    expect(clientPortalSource()).toContain('transition-[width] duration-300 motion-reduce:transition-none');
  });
});
