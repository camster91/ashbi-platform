// Unit tests for the hub→plugin HMAC client.
//
// Why this is a pure-Node test (no Fastify, no fetch):
//   The HMAC client is a thin wrapper around `crypto.createHmac('sha256', ...)`
//   whose contract is "sign over `timestamp + raw_body`, return headers in the
//   PR #17 wire format". That's a pure-function contract — no integration
//   surface to exercise. The integration surface (does the hub actually
//   forward these headers into fetch calls?) is covered by the fleet-ops
//   endpoint tests, which mock fetch and replay the captured body through
//   `verifyRequest` to confirm end-to-end.
//
// Run: node --test src/tests/unit/hmac-client.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { signRequest, verifyRequest } from '../../lib/hmac-client.js';

const SECRET = 'unit-test-secret-do-not-use-in-prod';

describe('signRequest — wire format', () => {
  test('produces sha256=<64-hex> signature and integer timestamp header', () => {
    const body = JSON.stringify({ filePath: '/tmp/x', find: 'a', replace: 'b' });
    const ts = 1718000000;
    const headers = signRequest({ method: 'POST', path: '/wp-json/ashbi/v1/file/patch', body, secret: SECRET, timestamp: ts });

    assert.match(headers['X-Ashbi-Signature'], /^sha256=[0-9a-f]{64}$/);
    assert.equal(headers['X-Ashbi-Timestamp'], '1718000000');
  });

  test('signature equals crypto.createHmac(sha256, secret).update(ts+body).digest("hex")', () => {
    // Cross-check against a from-scratch computation to prove the
    // canonical string is exactly `timestamp + body` and nothing else.
    const body = '{"cmd":"wp option get blogname"}';
    const ts = 1718000123;
    const headers = signRequest({ method: 'POST', path: '/wp-json/ashbi/v1/command', body, secret: SECRET, timestamp: ts });
    const expectedHex = crypto.createHmac('sha256', SECRET).update(String(ts) + body).digest('hex');
    assert.equal(headers['X-Ashbi-Signature'], `sha256=${expectedHex}`);
  });

  test('uses default timestamp (now) when timestamp omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const headers = signRequest({ method: 'POST', path: '/x', body: '{}', secret: SECRET });
    const after = Math.floor(Date.now() / 1000);
    const ts = parseInt(headers['X-Ashbi-Timestamp'], 10);
    assert.ok(ts >= before && ts <= after, `timestamp ${ts} not in [${before}, ${after}]`);
  });

  test('different methods/paths produce the SAME signature (they are not in canonical string)', () => {
    const body = '{"x":1}';
    const ts = 1718000000;
    const a = signRequest({ method: 'POST', path: '/wp-json/ashbi/v1/file/patch', body, secret: SECRET, timestamp: ts });
    const b = signRequest({ method: 'PUT',  path: '/wp-json/ashbi/v1/option/set',  body, secret: SECRET, timestamp: ts });
    assert.equal(a['X-Ashbi-Signature'], b['X-Ashbi-Signature']);
    assert.equal(a['X-Ashbi-Timestamp'], b['X-Ashbi-Timestamp']);
  });
});

describe('signRequest — input validation', () => {
  test('throws TypeError when secret is missing/empty (cannot sign with empty key)', () => {
    assert.throws(() => signRequest({ body: '{}', secret: '' }), /non-empty string/);
    assert.throws(() => signRequest({ body: '{}' }), /non-empty string/);
    assert.throws(() => signRequest({ body: '{}', secret: null }), /non-empty string/);
  });

  test('throws TypeError when body is not a string (prevents accidental re-serialize)', () => {
    assert.throws(() => signRequest({ body: { x: 1 }, secret: SECRET }), /exact raw string/);
    assert.throws(() => signRequest({ body: null, secret: SECRET }), /exact raw string/);
    assert.throws(() => signRequest({ body: 42, secret: SECRET }), /exact raw string/);
  });

  test('accepts empty string body', () => {
    // GET-like body (empty) is allowed; the canonical string is just the timestamp.
    const headers = signRequest({ body: '', secret: SECRET, timestamp: 1718000000 });
    const expectedHex = crypto.createHmac('sha256', SECRET).update('1718000000').digest('hex');
    assert.equal(headers['X-Ashbi-Signature'], `sha256=${expectedHex}`);
  });
});

describe('verifyRequest — replay + tamper detection', () => {
  test('valid signature passes verification', () => {
    const body = JSON.stringify({ name: 'blogname', value: 'My Site' });
    const ts = 1718000000;
    const { 'X-Ashbi-Signature': sig } = signRequest({ method: 'POST', path: '/x', body, secret: SECRET, timestamp: ts });
    assert.equal(verifyRequest({ signatureHeader: sig, timestamp: ts, body, secret: SECRET }), true);
  });

  test('tampered body fails verification', () => {
    const body = JSON.stringify({ name: 'blogname', value: 'My Site' });
    const ts = 1718000000;
    const { 'X-Ashbi-Signature': sig } = signRequest({ method: 'POST', path: '/x', body, secret: SECRET, timestamp: ts });
    // attacker flips one byte of the body in transit
    const tampered = body.replace('My Site', 'EVIL');
    assert.equal(verifyRequest({ signatureHeader: sig, timestamp: ts, body: tampered, secret: SECRET }), false);
  });

  test('tampered timestamp fails verification (replay attack prevented)', () => {
    const body = '{"cmd":"x"}';
    const ts = 1718000000;
    const { 'X-Ashbi-Signature': sig } = signRequest({ body, secret: SECRET, timestamp: ts });
    // attacker tries to keep the body but shift the timestamp
    assert.equal(verifyRequest({ signatureHeader: sig, timestamp: ts + 1, body, secret: SECRET }), false);
    assert.equal(verifyRequest({ signatureHeader: sig, timestamp: ts - 1, body, secret: SECRET }), false);
  });

  test('wrong secret fails verification', () => {
    const body = '{"x":1}';
    const ts = 1718000000;
    const { 'X-Ashbi-Signature': sig } = signRequest({ body, secret: SECRET, timestamp: ts });
    assert.equal(verifyRequest({ signatureHeader: sig, timestamp: ts, body, secret: 'wrong-secret' }), false);
  });

  test('returns false (does not throw) on malformed signature header', () => {
    const body = '{}';
    const ts = 1718000000;
    // missing sha256= prefix
    assert.equal(verifyRequest({ signatureHeader: 'plainhex', timestamp: ts, body, secret: SECRET }), false);
    // non-hex after prefix
    assert.equal(verifyRequest({ signatureHeader: 'sha256=zzzz', timestamp: ts, body, secret: SECRET }), false);
    // wrong length
    assert.equal(verifyRequest({ signatureHeader: 'sha256=deadbeef', timestamp: ts, body, secret: SECRET }), false);
    // non-string
    assert.equal(verifyRequest({ signatureHeader: null, timestamp: ts, body, secret: SECRET }), false);
    assert.equal(verifyRequest({ signatureHeader: undefined, timestamp: ts, body, secret: SECRET }), false);
  });

  test('returns false on length mismatch without throwing (timingSafeEqual guard)', () => {
    // timingSafeEqual requires equal-length buffers; verifyRequest must
    // gracefully return false when the attacker sends a different-length
    // signature instead of throwing.
    const body = '{}';
    const ts = 1718000000;
    const { 'X-Ashbi-Signature': sig } = signRequest({ body, secret: SECRET, timestamp: ts });
    // Truncate the hex portion by 1 char -> length mismatch
    const truncated = 'sha256=' + sig.slice('sha256='.length, -1);
    assert.equal(verifyRequest({ signatureHeader: truncated, timestamp: ts, body, secret: SECRET }), false);
  });
});

describe('signRequest — Unicode + edge cases', () => {
  test('Unicode body bytes are signed as-is (UTF-8 preserved)', () => {
    const body = JSON.stringify({ find: 'café', replace: 'naïve' });
    const ts = 1718000000;
    const headers = signRequest({ body, secret: SECRET, timestamp: ts });
    const expectedHex = crypto.createHmac('sha256', SECRET).update(String(ts) + body).digest('hex');
    assert.equal(headers['X-Ashbi-Signature'], `sha256=${expectedHex}`);
    // round-trip
    assert.equal(verifyRequest({ signatureHeader: headers['X-Ashbi-Signature'], timestamp: ts, body, secret: SECRET }), true);
  });

  test('large body (50KB) signs deterministically', () => {
    const big = JSON.stringify({ pad: 'x'.repeat(50_000) });
    const ts = 1718000000;
    const a = signRequest({ body: big, secret: SECRET, timestamp: ts });
    const b = signRequest({ body: big, secret: SECRET, timestamp: ts });
    assert.equal(a['X-Ashbi-Signature'], b['X-Ashbi-Signature']);
  });
});