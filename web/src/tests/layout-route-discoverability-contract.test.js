import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');

describe('shell route discoverability contract', () => {
  it('exposes registered chat and docs workflows in the primary shell navigation', () => {
    expect(layout).toContain("{ name: 'Chat', href: '/chat'");
    expect(layout).toContain("{ name: 'Docs', href: '/docs'");
    expect(layout).toContain("renderCollapsibleSection('finance', 'Finance & Docs'");
  });

  it('keeps discoverable navigation links keyboard-visible', () => {
    expect(layout).toContain('flex min-h-11 items-center');
    expect(layout).toContain('focus-visible:outline-none focus-visible:ring-2');
  });
});
