import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const routes = readFileSync(new URL('../../routes/push.routes.js', import.meta.url), 'utf8');

describe('push notification route contract', () => {
  it('requires an authenticated tenant context before returning the VAPID key', () => {
    assert.match(
      routes,
      /fastify\.get\('\/vapid-key',\s*\{\s*onRequest:\s*\[fastify\.authenticate\]/,
    );
  });

  it('requires authentication for subscription changes', () => {
    assert.equal((routes.match(/onRequest:\s*\[fastify\.authenticate\]/g) || []).length, 3);
  });
});
