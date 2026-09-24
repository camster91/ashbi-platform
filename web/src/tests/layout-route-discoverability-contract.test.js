import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf8');

describe('shell route discoverability contract', () => {
  it('exposes registered chat and docs workflows in the primary shell navigation', () => {
    expect(layout).toContain("{ name: 'Chat', href: '/chat'");
    expect(layout).toContain("{ name: 'Docs', href: '/docs'");
    expect(layout).toContain("renderCollapsibleSection('finance', 'Finance & Docs'");
  });

  it('exposes previously orphaned staff and admin workflows from the shell', () => {
    expect(layout).toContain("renderCollapsibleSection('tools', 'Tools'");
    expect(layout).toContain("{ name: 'Assets', href: '/assets'");
    expect(layout).toContain("{ name: 'Project Planner', href: '/project-planner'");
    expect(layout).toContain("{ name: 'Templates', href: '/project-templates'");
    expect(layout).toContain("{ name: 'Semantic Search', href: '/semantic-search'");
    expect(layout).toContain("{ name: 'Approvals', href: '/approvals'");
    expect(layout).toContain("{ name: 'Retainers', href: '/retainers'");
    expect(layout).toContain("{ name: 'Invoice Chaser', href: '/invoice-chaser'");

    for (const path of [
      '/assets',
      '/project-planner',
      '/project-templates',
      '/semantic-search',
      '/approvals',
      '/retainers',
      '/invoice-chaser',
    ]) {
      expect(app).toContain(`path="${path}"`);
    }
  });

  it('keeps discoverable navigation links keyboard-visible', () => {
    expect(layout).toContain('flex min-h-11 items-center');
    expect(layout).toContain('focus-visible:outline-none focus-visible:ring-2');
  });
});
