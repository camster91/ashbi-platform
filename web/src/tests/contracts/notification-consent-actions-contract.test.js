import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Layout.jsx'), 'utf8');
const settings = readFileSync(resolve(process.cwd(), 'src/pages/Settings.jsx'), 'utf8');

describe('notification consent action contract', () => {
  it('announces the purpose and associates it with the consent action', () => {
    expect(layout).toContain('id="push-consent-description"');
    expect(layout).toContain('aria-describedby="push-consent-description"');
    expect(layout).toContain('You can disable them anytime in Settings.');
  });

  it('uses shared pending semantics for enable actions', () => {
    expect(layout).toContain("isLoading={pushStatus === 'subscribing'}");
    expect(settings).toContain("isLoading={status === 'subscribing'}");
  });

  it('uses shared pending semantics for disable actions', () => {
    expect(settings).toContain("isLoading={status === 'unsubscribing'}");
  });
});
