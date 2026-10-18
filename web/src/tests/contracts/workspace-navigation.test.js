import { describe, expect, it } from 'vitest';
import { isWorkspaceDestinationActive } from '../../lib/workspace-navigation';

describe('workspace navigation route context', () => {
  it.each([
    ['/project/p/boards', '/projects'], ['/task/t', '/projects'], ['/review/r', '/projects'],
    ['/client/c', '/clients'], ['/thread/t', '/inbox'], ['/proposal/p', '/proposals'],
    ['/collections/c', '/collections'], ['/wiki/w', '/wiki'], ['/invoices/i', '/invoices'],
    ['/admin/brand', '/settings'], ['/automations', '/settings'],
  ])('keeps %s in its parent destination %s', (pathname, href) => {
    expect(isWorkspaceDestinationActive({ href }, pathname)).toBe(true);
  });

  it('does not confuse similarly named destinations or exact landing pages', () => {
    expect(isWorkspaceDestinationActive({ href: '/projects' }, '/project-templates')).toBe(false);
    expect(isWorkspaceDestinationActive({ href: '/clients' }, '/clients-other')).toBe(false);
    expect(isWorkspaceDestinationActive({ href: '/dashboard', exact: true }, '/dashboard/unknown')).toBe(false);
    expect(isWorkspaceDestinationActive({ href: '/inbox' }, '/proposal/p')).toBe(false);
  });
});
