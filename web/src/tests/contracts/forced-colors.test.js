import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Forced-colours contract (#317). Windows contrast themes drop box-shadows and
// background fills, which removes Tailwind focus rings, button fills and
// tinted badges; index.css restores each cue with CSS system colours.
const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\r\n/g, '\n');
const start = css.indexOf('@media (forced-colors: active)');
const block = start >= 0 ? css.slice(start, css.indexOf('\n}\n', start)) : '';
const doc = readFileSync(resolve(process.cwd(), '../docs/ui-primitives.md'), 'utf8');

describe('forced colours', () => {
  it('has a forced-colors block in the global stylesheet', () => {
    expect(start).toBeGreaterThan(-1);
  });

  it('gives every focusable element a Highlight outline', () => {
    expect(block).toMatch(/:focus-visible\s*\{\s*outline: 3px solid Highlight !important;/);
    for (const selector of ['a', 'button', 'input', 'select', 'textarea', '[tabindex]']) {
      expect(block).toContain(selector);
    }
  });

  it('keeps button and tab boundaries, and greys out disabled ones', () => {
    expect(block).toMatch(/\[role='tab'\][^{]*\)\s*\{\s*border: 1px solid ButtonText;/);
    expect(block).toMatch(/:disabled[^{]*\{\s*border-color: GrayText;\s*color: GrayText;/);
  });

  it('marks selected, pressed and current items with Highlight', () => {
    for (const selector of ["[role='tab'][aria-selected='true']", "[aria-pressed='true']", "[aria-current='page']"]) {
      expect(block).toContain(selector);
    }
    expect(block).toMatch(/outline: 2px solid Highlight;/);
  });

  it('outlines badges and status pills, invalid fields and spinners', () => {
    expect(block).toMatch(/\.status-indicator\s*\{\s*border: 1px solid CanvasText;/);
    expect(block).toMatch(/\[aria-invalid='true'\]\s*\{\s*border-color: Mark;/);
    expect(block).toMatch(/\.animate-spin\s*\{\s*border-top-color: Highlight;/);
  });

  it('only uses system colours inside the block', () => {
    expect(block).not.toMatch(/#[0-9a-f]{3,8}\b|hsl\(|rgb\(/i);
  });

  it('puts the status-indicator hook on every Badge (and so every StatusBadge)', () => {
    const badge = readFileSync(resolve(process.cwd(), 'src/components/ui/Badge.jsx'), 'utf8');
    expect(badge).toContain("'status-indicator inline-flex");
  });

  it('is documented in docs/ui-primitives.md', () => {
    expect(doc).toContain('<a id="forced-colours"></a>**Forced colours**');
    for (const colour of ['Highlight', 'ButtonText', 'GrayText', 'CanvasText', 'Mark']) {
      expect(doc).toContain(colour);
    }
  });
});
