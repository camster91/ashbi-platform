import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workerPath = resolve(process.cwd(), 'public', 'sw.js');

describe('service worker private-data contract', () => {
  it('keeps API requests network-only', async () => {
    const source = await readFile(workerPath, 'utf8');

    expect(source).toContain("url.pathname.startsWith('/api/')");
    expect(source).toContain('event.respondWith(networkOnly(request))');
    expect(source).not.toMatch(/networkFirst\(request,\s*API_CACHE\)/);
    expect(source).not.toMatch(/cache\.put\([^\n]*api/i);
  });

  it('purges every legacy API cache on activation and explicit messages', async () => {
    const source = await readFile(workerPath, 'utf8');

    expect(source).toContain("LEGACY_API_CACHE_PREFIX = 'hub-api-'");
    expect(source).toContain("event.data?.type !== 'PURGE_PRIVATE_CACHES'");
    expect(source).toContain('event.waitUntil(deleteLegacyApiCaches())');
    expect(source).toMatch(/key\.startsWith\(LEGACY_API_CACHE_PREFIX\)/);
  });

  it('preserves the static asset offline strategy', async () => {
    const source = await readFile(workerPath, 'utf8');

    expect(source).toContain('event.respondWith(cacheFirst(request, STATIC_CACHE))');
  });
});
