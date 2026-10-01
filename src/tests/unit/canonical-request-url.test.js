import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRequestUrl, requestPath } from '../../config/http.js';
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

test('a malformed escape is never decoded into a new one', () => {
  // One decode of %31 would turn /%6%31pi into /%61pi, which the router then
  // dispatches to /api; left as sent, the router rejects it.
  assert.equal(canonicalRequestUrl('/%6%31pi/clients'), '/%6%31pi/clients');
  assert.equal(canonicalRequestUrl('/%%36%31pi/clients'), '/%%36%31pi/clients');
});

test('absolute-form targets are reduced the way the router reduces them', () => {
  assert.equal(canonicalRequestUrl('http://x/api/clients'), '/api/clients');
  assert.equal(canonicalRequestUrl('https://evil.example/%61pi/clients?a=1'), '/api/clients?a=1');
  assert.equal(canonicalRequestUrl('http://user@x/api/clients'), '/api/clients');
});

test('security checks read the matched route, not the URL spelling', () => {
  assert.equal(requestPath({ routeOptions: { url: '/api/clients/:id' }, url: 'http://x/%61pi/clients/1' }), '/api/clients/:id');
  assert.equal(requestPath({ url: '/nope?x=1' }), '/nope');
  assert.equal(isNonApiRequest({ routeOptions: { url: '/api/auth/login' }, url: 'http://x/api/auth/login' }), false);
  assert.equal(isNonApiRequest({ routeOptions: { url: '/api/health' }, url: '/api/health' }), true);
  assert.equal(isNonApiRequest({ routeOptions: { url: '/*' }, url: '/app/settings' }), true);
});
