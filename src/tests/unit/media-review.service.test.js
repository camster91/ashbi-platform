// Media review rules (#417, docs/media-review.md): token handling, expiry,
// text sanitising, anchors, and share-link tokens never reaching logs.
import assert from 'node:assert/strict';
import test from 'node:test';

const review = await import('../../services/media-review.service.js');
const { redactCapabilityUrl, serializeRequestForLog } = await import('../../utils/log-redaction.js');

test('share tokens are 256-bit base64url and stored only as SHA-256', () => {
  const { token, tokenHash } = review.generateShareToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(review.hashShareToken(token), tokenHash);
  assert.notEqual(review.generateShareToken().token, token);
  assert.equal(review.isWellFormedShareToken(token), true);
  for (const bad of ['', 'short', `${token}x`, `${token.slice(0, 42)}/`, null, 42]) {
    assert.equal(review.isWellFormedShareToken(bad), false, String(bad));
  }
});

test('token lookup never queries for a malformed token and re-checks the digest', async () => {
  const { token, tokenHash } = review.generateShareToken();
  const calls = [];
  const prisma = { reviewShareLink: { findUnique: async (args) => { calls.push(args); return args.where.tokenHash === tokenHash ? { id: 'l1', tokenHash } : null; } } };
  assert.equal(await review.findShareLinkByToken(prisma, 'nope'), null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await review.findShareLinkByToken(prisma, token), { id: 'l1', tokenHash });
  assert.equal(calls[0].where.tokenHash, tokenHash);
  const lying = { reviewShareLink: { findUnique: async () => ({ id: 'l2', tokenHash: 'f'.repeat(64) }) } };
  assert.equal(await review.findShareLinkByToken(lying, token), null);
});

test('share links default to 14 days and never exceed 90', () => {
  const now = new Date('2026-09-26T00:00:00Z');
  assert.equal(review.shareLinkExpiry(undefined, now).expiresAt.toISOString(), '2026-10-10T00:00:00.000Z');
  assert.equal(review.shareLinkExpiry(90, now).days, 90);
  for (const bad of [0, 91, 1.5, -1]) assert.ok(review.shareLinkExpiry(bad, now).error, String(bad));
  const link = { expiresAt: new Date(now.getTime() + 1000), revokedAt: null };
  assert.equal(review.shareLinkFailure(link, now), null);
  assert.equal(review.shareLinkFailure({ ...link, expiresAt: now }, now).statusCode, 410);
  assert.equal(review.shareLinkFailure({ ...link, revokedAt: now }, now).error, 'This review link has been revoked');
  assert.equal(review.shareLinkFailure(null, now).statusCode, 404);
});

test('comments and guest names are plain text without control or bidi characters', () => {
  assert.equal(review.sanitizePlainText(' a\r\nb\u0000‮c\t '), 'a\nbc');
  assert.equal(review.sanitizeGuestName('  Jo\n  Client⁦ '), 'Jo Client');
  assert.equal(review.sanitizeGuestName('x'.repeat(200)).length, 120);
});

test('anchors must match the media kind', () => {
  assert.equal(review.annotationPositionError('video', { timecodeMs: 10 }), null);
  assert.equal(review.annotationPositionError('audio', { timecodeMs: 10 }), null);
  assert.equal(review.annotationPositionError('image', { region: { x: 0, y: 0, w: 1, h: 1 } }), null);
  assert.equal(review.annotationPositionError('pdf', { pageNumber: 3 }), null);
  assert.ok(review.annotationPositionError('image', { timecodeMs: 10 }));
  assert.ok(review.annotationPositionError('video', { pageNumber: 1 }));
  assert.ok(review.annotationPositionError('pdf', { region: { x: 0, y: 0, w: 0.1, h: 0.1 } }));
  assert.ok(review.annotationPositionError('image', { region: { x: 0.5, y: 0.5, w: 0.6, h: 0.1 } }));
  assert.ok(review.annotationPositionError('video', { parentId: 'p', timecodeMs: 1 }));
  assert.deepEqual(review.annotationPositionData({ region: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }), {
    timecodeMs: null, pageNumber: null, regionX: 0.1, regionY: 0.2, regionW: 0.3, regionH: 0.4,
  });
});

test('only images, PDFs, video and audio are reviewable', () => {
  assert.equal(review.mediaKindFor('image/png'), 'image');
  assert.equal(review.mediaKindFor('video/webm;codecs=vp9'), 'video');
  assert.equal(review.mediaKindFor('application/pdf'), 'pdf');
  assert.equal(review.mediaKindFor('audio/mpeg'), 'audio');
  assert.equal(review.mediaKindFor('application/zip'), null);
  assert.equal(review.mediaKindFor('image/svg+xml'), null);
  assert.equal(review.isQuarantined({ path: '/uploads/quarantine/x.png' }), true);
});

test('request logs mask review share-link tokens in the URL', () => {
  const { token } = review.generateShareToken();
  assert.equal(redactCapabilityUrl(`/api/portal/review/${token}/file`), '/api/portal/review/[Redacted]/file');
  assert.equal(redactCapabilityUrl(`/portal/review/${token}`), '/portal/review/[Redacted]');
  assert.equal(redactCapabilityUrl('/api/reviews/abc'), '/api/reviews/abc');
  const logged = serializeRequestForLog({ method: 'GET', url: `/api/portal/review/${token}`, headers: {}, host: 'h', ip: '203.0.113.9' });
  assert.equal(JSON.stringify(logged).includes(token), false);
  assert.deepEqual(Object.keys(logged), ['method', 'url', 'version', 'host', 'remoteAddress', 'remotePort']);
});

test('the application request logger never writes a share-link token', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';
  const { buildApp } = await import('../../index.js');
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'test-only-jwt-secret' });
  try {
    const serializer = app.log[Object.getOwnPropertySymbols(app.log).find((symbol) => symbol.description === 'pino.serializers')];
    const { token } = review.generateShareToken();
    const logged = serializer.req({ method: 'GET', url: `/api/portal/review/${token}`, headers: {}, host: 'h', ip: '203.0.113.9' });
    assert.equal(JSON.stringify(logged).includes(token), false);
  } finally {
    await app.close();
  }
});
