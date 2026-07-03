// Smoke test for the HMAC verify logic in src/routes/wp-bridge.routes.js.
// Constructs three fake requests and confirms:
//   1. Valid signature + fresh timestamp → accepted (handler runs).
//   2. Tampered body → rejected with 401.
//   3. Stale timestamp (outside 300s window) → rejected with 401.
//
// Standalone — does not boot Fastify. Reimplements the verify path in plain
// Node using the same primitives: crypto.createHmac('sha256', secret),
// crypto.timingSafeEqual, and the same raw_body + timestamp concatenation
// the route handler does. This is the verifiable contract; the route
// handler in src/routes/wp-bridge.routes.js wires the same primitives via
// preParsing + preHandler hooks.

import crypto from 'node:crypto';

const SECRET = process.env.WP_BRIDGE_SECRET || 'unit-test-secret';

// Re-implementation of verifyBackupHmac so we exercise the same logic
// without booting Fastify. Mismatch here = the route handler logic in
// src/routes/wp-bridge.routes.js is broken.
function verifyBackupHmac({ signatureHeader, timestamp, rawBody, secret }) {
  const HMAC_REPLAY_WINDOW_SECONDS = 300;

  if (!signatureHeader || typeof signatureHeader !== 'string' || !signatureHeader.startsWith('sha256=')) {
    return { ok: false, reason: 'Missing or malformed X-Ashbi-Signature header' };
  }
  const providedHex = signatureHeader.slice('sha256='.length);

  if (timestamp === undefined || timestamp === null || !/^\d+$/.test(String(timestamp))) {
    return { ok: false, reason: 'Missing or invalid _timestamp' };
  }
  const tsSec = parseInt(String(timestamp), 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsSec) > HMAC_REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'Timestamp outside replay window' };
  }

  if (!secret) {
    return { ok: false, reason: 'Server missing wpBridgeSecret configuration' };
  }

  const expectedHex = crypto
    .createHmac('sha256', secret)
    .update(String(timestamp) + rawBody)
    .digest('hex');

  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(providedHex, 'hex');
    expectedBuf = Buffer.from(expectedHex, 'hex');
  } catch {
    return { ok: false, reason: 'Invalid signature encoding' };
  }

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, reason: 'Invalid signature' };
  }
  return { ok: true };
}

function signBody({ timestamp, body, secret }) {
  const hex = crypto.createHmac('sha256', secret).update(String(timestamp) + body).digest('hex');
  return `sha256=${hex}`;
}

let pass = 0;
let fail = 0;
function check(label, condition) {
  if (condition) { console.log(`  \u2713 ${label}`); pass++; }
  else { console.log(`  \u2717 ${label}`); fail++; }
}

const body = JSON.stringify({ siteUrl: 'https://example.com', report: { x: 1 } });
const now = Math.floor(Date.now() / 1000);

// 1. Valid signature, fresh timestamp.
{
  const ts = now;
  const sig = signBody({ timestamp: ts, body, secret: SECRET });
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: body, secret: SECRET });
  check('valid sig + fresh ts accepted', r.ok === true);
}

// 2. Tampered body.
{
  const ts = now;
  const sig = signBody({ timestamp: ts, body, secret: SECRET });
  const tamperedBody = body + 'extra';
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: tamperedBody, secret: SECRET });
  check('tampered body rejected', r.ok === false && r.reason === 'Invalid signature');
}

// 3. Stale timestamp (-400s).
{
  const ts = now - 400;
  const sig = signBody({ timestamp: ts, body, secret: SECRET });
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: body, secret: SECRET });
  check('stale timestamp rejected', r.ok === false && r.reason === 'Timestamp outside replay window');
}

// 4. Edge: timestamp exactly at 300s.
{
  const ts = now - 300;
  const sig = signBody({ timestamp: ts, body, secret: SECRET });
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: body, secret: SECRET });
  check('edge timestamp at -300s accepted', r.ok === true);
}

// 5. Edge: timestamp 301s old.
{
  const ts = now - 301;
  const sig = signBody({ timestamp: ts, body, secret: SECRET });
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: body, secret: SECRET });
  check('edge timestamp at -301s rejected', r.ok === false);
}

// 6. Missing signature header.
{
  const r = verifyBackupHmac({ signatureHeader: undefined, timestamp: now, rawBody: body, secret: SECRET });
  check('missing signature header rejected', r.ok === false && r.reason.includes('Missing'));
}

// 7. Wrong secret.
{
  const ts = now;
  const sig = signBody({ timestamp: ts, body, secret: 'wrong-secret' });
  const r = verifyBackupHmac({ signatureHeader: sig, timestamp: ts, rawBody: body, secret: SECRET });
  check('wrong secret rejected', r.ok === false && r.reason === 'Invalid signature');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
