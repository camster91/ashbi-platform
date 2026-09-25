import { describe, expect, it } from 'vitest';
import { clientPortalSource } from './helpers/clientPortalSource';

const source = clientPortalSource();

describe('client portal navigation accessibility contract', () => {
  it('exposes selected state and keyboard-visible focus for project detail tabs', () => {
    expect(source).toContain('role="tablist"');
    expect(source).toContain('role="tab"');
    expect(source).toContain('aria-selected={activeView === tab.id}');
    expect(source).toContain('className="cp-tab"');
  });

  it('exposes selected state for the portal-level tabs', () => {
    expect(source).toContain('aria-selected={activeTab === tab.id}');
    expect(source).toContain('aria-label="Portal sections"');
    expect(source).toContain('type="button"');
  });
});
