import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRequestUrl } from '../../config/http.js';
import { isNonApiRequest } from '../../config/rateLimit.js';

test('escaped unreserved characters are decoded before routing', () => {
  assert.equal(canonicalRequestUrl('/%61pi/clients'), '/api/clients');
  assert.equal(canonicalRequestUrl('/%61%70%69/auth/login'), '/api/auth/login');
  assert.equal(canonicalRequestUrl('/api/%63lients/a%2Db%5F%7E'), '/api/clients/a-b_~');
});

test('reserved escapes and the query string are left as sent', () => {
  assert.equal(canonicalRequestUrl('/api/files/a%2Fb'), '/api/files/a%2Fb');
  assert.equal(canonicalRequestUrl('/api/x%20y'), '/api/x%20y');
  assert.equal(canonicalRequestUrl('/api/x%2f'), '/api/x%2F');
  assert.equal(canonicalRequestUrl('/api/search?q=%61%26b'), '/api/search?q=%61%26b');
  assert.equal(canonicalRequestUrl('/api/clients'), '/api/clients');
  assert.equal(canonicalRequestUrl('/%2561pi'), '/%2561pi');
});

test('the rate limiter treats a canonicalised encoded API path as API traffic', () => {
  const url = canonicalRequestUrl('/%61pi/auth/login');
  assert.equal(isNonApiRequest({ url, raw: { url } }), false);
});
