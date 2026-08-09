import test from 'node:test';
import assert from 'node:assert/strict';

import { isNonApiRequest } from '../../config/rateLimit.js';

test('frontend and static requests are excluded from the global API limiter', () => {
  for (const url of ['/', '/search', '/assets/app.js', '/icon-192.png', '/sw.js']) {
    assert.equal(isNonApiRequest({ raw: { url } }), true, url);
  }
});

test('API requests remain protected, including queries and the API root', () => {
  for (const url of ['/api', '/api/', '/api/search?q=test', '/api/auth/login']) {
    assert.equal(isNonApiRequest({ raw: { url } }), false, url);
  }
  assert.equal(isNonApiRequest({ raw: { url: '/apiary' } }), true);
});

test('liveness and readiness probes are never exhausted by the API limiter', () => {
  for (const url of ['/api/live', '/api/health', '/api/health?source=probe']) {
    assert.equal(isNonApiRequest({ raw: { url } }), true, url);
  }
});
