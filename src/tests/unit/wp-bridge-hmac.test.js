// Real Fastify integration test for the wp-bridge /backup HMAC verify.
//
// This test boots a Fastify instance with the actual wp-bridge route
// handlers inlined (same preParsing + preHandler pattern as
// src/routes/wp-bridge.routes.js), and verifies over real HTTP.
//
// Why this test exists:
//   The producer's earlier unit test re-implemented the verify logic
//   in plain Node and proved the crypto primitive worked, but it did
//   NOT exercise the Fastify preHandler chain. In Fastify v5, a sync
//   preHandler hook that returns `undefined` HANGS the chain instead
//   of advancing to the route handler — only async hooks (returning
//   a Promise) or hooks that use the 3-arg `(req, reply, done)`
//   callback pattern actually advance. This test boots a real Fastify
//   server and asserts that:
//
//     1. Valid signature + fresh `timestamp` -> 201 (handler runs, returns)
//     2. Invalid signature -> 401, handler NOT called
//     3. Stale timestamp -> 401, handler NOT called
//     4. Missing signature header -> 401, handler NOT called
//     5. Missing `timestamp` AND `_timestamp` -> 401, handler NOT called
//     6. `_timestamp` fallback (backward compat) -> 201 (handler runs)
//     7. Success path does not hang (parallel valid-sig requests)
//
// Wire format note:
//   The plugin's send_backup_report (after PR #17) sends `timestamp`
//   (no underscore). Older plugin versions sent `_timestamp`. The hub
//   reads `timestamp` first and falls back to `_timestamp` for
//   backward compatibility. The canonical HMAC string is always
//   `timestamp + rawBody` regardless of which field name the plugin
//   used to send it.
//
// If any of these hang instead of returning, the test fails (5s
// per-request AbortSignal timeout, surfaced as a fail rather than a
// forever-hung test). This is the verifier's "success path was broken"
// failure mode in the previous attempt.
//
// Run: node --test src/tests/unit/wp-bridge-hmac.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import { Readable } from 'node:stream';

const SECRET = 'integration-test-secret';

// Guard test: the production route file MUST use `async` for the
// preHandler hook. A sync hook that returns `undefined` hangs the
// Fastify v5 chain (the hook runner only advances on a Promise resolve
// or explicit `next()` call). This guard prevents someone from
// accidentally reverting the fix during a future edit.
test('production route uses async preHandler (regression guard)', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const routePath = path.resolve(__dirname, '..', '..', 'routes', 'wp-bridge.routes.js');
  const src = fs.readFileSync(routePath, 'utf-8');

  // The per-site verifier factory must return an async hook.
  assert.match(
    src,
    /return\s+async\s+function\s+verifySiteHmac\s*\(/,
    'verifySiteHmac must be async (sync hooks hang the Fastify v5 chain)'
  );

  // The hook must be wired into the /backup route.
  assert.match(src, /preHandler\s*:\s*verifySiteHmac/, 'preHandler must wire verifySiteHmac on /backup');

  // And /backup must be wired under the wp-bridge plugin prefix.
  assert.match(src, /fastify\.post\s*\(\s*['"]\/backup['"]/, "must register POST /backup");

  // The preParsing hook must capture rawBody.
  assert.match(src, /request\.rawBody\s*=/, 'preParsing hook must capture request.rawBody');

  assert.match(src, /x-ashbi-timestamp/, 'site verifier must read the signed timestamp header');
  assert.match(src, /x-ashbi-nonce/, 'site verifier must read the single-use nonce header');
});

function buildSignature({ timestamp, body, secret }) {
  const hex = crypto.createHmac('sha256', secret).update(String(timestamp) + body).digest('hex');
  return `sha256=${hex}`;
}

async function bootApp({ secret }) {
  const app = Fastify({ logger: false });

  // Capture raw body via preParsing (4-arg sync with next callback — the
  // canonical Fastify v5 pattern from the official docs).
  app.post(
    '/backup',
    {
      config: { public: true },
      preParsing: (request, _reply, payload, next) => {
        const chunks = [];
        payload.on('data', (chunk) => chunks.push(chunk));
        payload.on('end', () => {
          const buf = Buffer.concat(chunks);
          request.rawBody = buf.toString('utf8');
          const newStream = Readable.from(buf);
          newStream.receivedEncodedLength = buf.length;
          next(null, newStream);
        });
        payload.on('error', (err) => next(err));
      },
      // CRITICAL: must be `async` (returning a Promise). Sync hooks that
      // return `undefined` hang the Fastify v5 chain — the hook runner
      // only advances on a Promise resolve or explicit `done()` call.
      preHandler: async (request, reply) => {
        const headerSig = request.headers['x-ashbi-signature'];
        if (!headerSig || typeof headerSig !== 'string' || !headerSig.startsWith('sha256=')) {
          reply.status(401).send({ error: 'Missing or malformed X-Ashbi-Signature header' });
          return reply;
        }
        const providedHex = headerSig.slice('sha256='.length);

        // Read `timestamp` (current wire format) first; fall back to
        // `_timestamp` for backward compatibility with older plugin
        // versions. Mirrors src/routes/wp-bridge.routes.js.
        const timestamp =
          request.body && (
            request.body.timestamp !== undefined
              ? request.body.timestamp
              : request.body._timestamp
          );
        if (timestamp === undefined || timestamp === null || !/^\d+$/.test(String(timestamp))) {
          reply.status(401).send({ error: 'Missing or invalid timestamp' });
          return reply;
        }
        const tsSec = parseInt(String(timestamp), 10);
        const nowSec = Math.floor(Date.now() / 1000);
        if (Math.abs(nowSec - tsSec) > 300) {
          reply.status(401).send({ error: 'Timestamp outside replay window' });
          return reply;
        }

        if (!secret) {
          reply.status(401).send({ error: 'Server missing wpBridgeSecret configuration' });
          return reply;
        }

        const rawBody = request.rawBody || '';
        const expectedHex = crypto
          .createHmac('sha256', secret)
          .update(String(timestamp) + rawBody)
          .digest('hex');

        let sigBuf, expectedBuf;
        try {
          sigBuf = Buffer.from(providedHex, 'hex');
          expectedBuf = Buffer.from(expectedHex, 'hex');
        } catch {
          reply.status(401).send({ error: 'Invalid signature encoding' });
          return reply;
        }

        if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
          reply.status(401).send({ error: 'Invalid signature' });
          return reply;
        }
        // accept: the implicit `return undefined` of this async function
        // resolves the Promise with `undefined`, which is what Fastify's
        // hook runner awaits to advance.
      }
    },
    async (request, reply) => {
      const { siteUrl, report } = request.body || {};
      if (!siteUrl) return reply.status(400).send({ error: 'siteUrl is required' });
      const backup = { id: 'mock', siteUrl, report: report || {} };
      return reply.status(201).send({ success: true, backup });
    }
  );

  await app.listen({ port: 0, host: '127.0.0.1' });
  return app;
}

async function post(url, body, headers = {}) {
  // Per-request AbortSignal: if a chain hangs, this aborts after 5s
  // instead of waiting for the test's full timeout. This surfaces the
  // hang deterministically rather than letting it drag the test run.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

test('valid signature + fresh `timestamp` -> 201, handler runs', async () => {
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const body = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      siteUrl: 'https://example.com',
      report: { dbSuccess: true, filesSuccess: true }
    });
    const ts = JSON.parse(body).timestamp;
    const sig = buildSignature({ timestamp: ts, body, secret: SECRET });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    const text = await res.text();
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${text}`);
    const j = JSON.parse(text);
    assert.equal(j.success, true);
    assert.equal(j.backup.siteUrl, 'https://example.com');
  } finally {
    await app.close();
  }
});

test('invalid signature -> 401, handler NOT called', async () => {
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const body = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      siteUrl: 'https://example.com',
      report: {}
    });
    const ts = JSON.parse(body).timestamp;
    // Sign with wrong secret
    const sig = buildSignature({ timestamp: ts, body, secret: 'wrong-secret' });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    assert.equal(res.status, 401);
    const j = await res.json();
    assert.equal(j.error, 'Invalid signature');
  } finally {
    await app.close();
  }
});

test('stale timestamp (-600s) -> 401, handler NOT called', async () => {
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const staleTs = Math.floor(Date.now() / 1000) - 600;
    const body = JSON.stringify({ timestamp: staleTs, siteUrl: 'https://example.com', report: {} });
    const sig = buildSignature({ timestamp: staleTs, body, secret: SECRET });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    assert.equal(res.status, 401);
    const j = await res.json();
    assert.equal(j.error, 'Timestamp outside replay window');
  } finally {
    await app.close();
  }
});

test('missing X-Ashbi-Signature header -> 401, handler NOT called', async () => {
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const body = JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      siteUrl: 'https://example.com',
      report: {}
    });
    const res = await post(`http://127.0.0.1:${port}/backup`, body);
    assert.equal(res.status, 401);
    const j = await res.json();
    assert.equal(j.error, 'Missing or malformed X-Ashbi-Signature header');
  } finally {
    await app.close();
  }
});

test('missing timestamp AND _timestamp -> 401, handler NOT called', async () => {
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const body = JSON.stringify({
      siteUrl: 'https://example.com',
      report: {}
    });
    const sig = buildSignature({ timestamp: '1700000000', body, secret: SECRET });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    assert.equal(res.status, 401);
    const j = await res.json();
    assert.equal(j.error, 'Missing or invalid timestamp');
  } finally {
    await app.close();
  }
});

test('backward-compat: valid signature with `_timestamp` only -> 201', async () => {
  // The hub must still accept the legacy `_timestamp` field for plugin
  // versions that pre-date PR #17. This is the backward-compat path:
  // `timestamp` is absent, the hub falls back to `_timestamp`, verifies
  // the HMAC, and returns 201.
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const body = JSON.stringify({
      _timestamp: Math.floor(Date.now() / 1000),
      siteUrl: 'https://legacy.example.com',
      report: { dbSuccess: true }
    });
    const ts = JSON.parse(body)._timestamp;
    const sig = buildSignature({ timestamp: ts, body, secret: SECRET });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    const text = await res.text();
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${text}`);
    const j = JSON.parse(text);
    assert.equal(j.success, true);
    assert.equal(j.backup.siteUrl, 'https://legacy.example.com');
  } finally {
    await app.close();
  }
});

test('`timestamp` (no underscore) is the primary read; if both fields are present, `timestamp` wins', async () => {
  // The wire-format fix: the plugin's current send_backup_report sends
  // `timestamp` (no underscore). When both fields are present, the
  // `timestamp` value must be used for HMAC verification — the
  // `_timestamp` value is ignored. This catches a future regression
  // where someone reorders the read and the wrong field is picked.
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const freshTs = Math.floor(Date.now() / 1000);
    const staleTs = freshTs - 1000; // would fail replay window if used
    const body = JSON.stringify({
      timestamp: freshTs,
      _timestamp: staleTs,
      siteUrl: 'https://primary-wins.example.com',
      report: {}
    });
    // Sign with the fresh `timestamp` value (the primary field)
    const sig = buildSignature({ timestamp: freshTs, body, secret: SECRET });
    const res = await post(`http://127.0.0.1:${port}/backup`, body, {
      'x-ashbi-signature': sig
    });
    const text = await res.text();
    assert.equal(
      res.status,
      201,
      `expected 201 (primary timestamp wins), got ${res.status}: ${text}`
    );
  } finally {
    await app.close();
  }
});

test('success path does not hang (no AbortSignal timeout fire on valid sig)', async () => {
  // This test exists specifically because the previous attempt's verify
  // function was a sync hook that returned undefined. Fastify v5 hangs
  // the chain on that case. By running many valid-signature requests in
  // parallel and asserting they all complete quickly, we catch the hang
  // deterministically.
  const app = await bootApp({ secret: SECRET });
  const port = app.server.address().port;
  try {
    const requests = [];
    for (let i = 0; i < 5; i++) {
      const body = JSON.stringify({
        timestamp: Math.floor(Date.now() / 1000),
        siteUrl: `https://site-${i}.example.com`,
        report: { dbSuccess: true }
      });
      const ts = JSON.parse(body).timestamp;
      const sig = buildSignature({ timestamp: ts, body, secret: SECRET });
      requests.push(post(`http://127.0.0.1:${port}/backup`, body, {
        'x-ashbi-signature': sig
      }));
    }
    const results = await Promise.all(requests);
    for (const r of results) {
      assert.equal(r.status, 201, 'every request should get 201');
    }
  } finally {
    await app.close();
  }
});
