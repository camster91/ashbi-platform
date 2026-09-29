// Media review markup, tracking and web page review (docs/media-review.md
// "Markup", "Tracking" and "Web page review"), against the in-memory review
// database wrapped by the real tenant proxy. The page capture service is
// stubbed: its SSRF controls have their own tests (web-capture.service).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

const { default: reviewRoutes } = await import('../../routes/review.routes.js');
const { default: reviewPortalRoutes } = await import('../../routes/review-portal.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { reauthCookies, withSession } = await import('../helpers/reauth.js');
const { createFakeReviewDb, seedReviewOrganizations } = await import('../helpers/fake-review-db.js');
const { WebCaptureError } = await import('../../services/web-capture.service.js');

const USERS = {
  adminA: { id: 'admin-a', role: 'ADMIN', organizationId: 'org-a', name: 'Avery Admin', email: 'avery@a.test' },
  teamA: { id: 'team-a', role: 'TEAM', organizationId: 'org-a', name: 'Terry Team', email: 'terry@a.test' },
  adminB: { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b', name: 'Blake Admin', email: 'blake@b.test' },
};

// Smallest valid PNG signature plus padding: enough for the upload policy.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

async function setup(t, { webCaptureEnabled = false, captureWebPage } = {}) {
  const db = seedReviewOrganizations(createFakeReviewDb());
  db.tables.user.push(
    { id: 'admin-a', organizationId: 'org-a', role: 'ADMIN', isActive: true, name: 'Avery Admin' },
    { id: 'team-a', organizationId: 'org-a', role: 'TEAM', isActive: true, name: 'Terry Team' },
    { id: 'retired-a', organizationId: 'org-a', role: 'TEAM', isActive: false, name: 'Retired' },
    { id: 'client-user-a', organizationId: 'org-a', role: 'CLIENT', isActive: true, name: 'Client User' },
    { id: 'admin-b', organizationId: 'org-b', role: 'ADMIN', isActive: true, name: 'Blake Admin' },
  );
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-capture-'));
  const notifications = [];
  const captures = [];
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorate('notify', async (userId, notification) => { notifications.push({ userId, ...notification }); });
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/portal/')) request.prisma = db;
  });
  app.decorate('authenticate', async (request, reply) => {
    const user = USERS[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = withSession(user);
    request.prisma = createScopedPrisma(db, user.organizationId);
    return undefined;
  });
  const stubCapture = captureWebPage ?? (async (input) => {
    captures.push(input);
    const url = new URL(input.url);
    url.hash = ''; // as the real service normalizes it
    return { png: PNG, url: url.href, finalUrl: url.href, viewport: input.viewport, width: 1440, height: 900, truncated: false, pageTitle: 'Example' };
  });
  await app.register(reviewRoutes, { prefix: '/api/reviews', webCaptureEnabled, captureWebPage: stubCapture, uploadDir });
  await app.register(reviewPortalRoutes, { prefix: '/api/portal/review' });
  t.after(async () => {
    await app.close();
    fs.rmSync(uploadDir, { recursive: true, force: true });
  });
  const staff = (key, method, url, payload, { reauth = false } = {}) => app.inject({
    method, url: `/api/reviews${url}`, payload, headers: { 'x-test-user': key }, cookies: reauth ? reauthCookies(USERS[key]) : {},
  });
  const guest = (method, url, payload) => app.inject({ method, url: `/api/portal/review/${url}`, payload });
  const createSession = async (body = {}, key = 'teamA') => {
    const response = await staff(key, 'POST', '', { projectId: 'project-a', attachmentId: 'image-a', title: 'Homepage', ...body });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().session;
  };
  return { db, app, staff, guest, createSession, notifications, captures, uploadDir };
}

describe('review markup shapes', () => {
  it('stores pins, areas, arrows and strokes normalized, and rejects malformed geometry', async (t) => {
    const { staff, db, createSession } = await setup(t);
    const image = await createSession();
    const post = (body, id = image.id) => staff('teamA', 'POST', `/${id}/annotations`, body);

    const area = await post({ body: 'Hero too dark', shape: 'rect', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, color: 'orange' });
    assert.equal(area.statusCode, 201, area.body);
    assert.deepEqual(
      [area.json().annotation.shape, area.json().annotation.region, area.json().annotation.color],
      ['rect', { x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, 'orange'],
    );
    const stroke = await post({ body: 'Circle this', shape: 'pen', points: [[0.5, 0.25], [0.25, 0.75], [0.75, 0.5]] });
    assert.equal(stroke.statusCode, 201, stroke.body);
    assert.deepEqual(stroke.json().annotation.points, [[0.5, 0.25], [0.25, 0.75], [0.75, 0.5]]);
    assert.deepEqual(stroke.json().annotation.region, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
    const arrow = await post({ body: 'Move this', shape: 'arrow', points: [[0.9, 0.9], [0.6, 0.5]], color: 'blue' });
    assert.equal(arrow.statusCode, 201, arrow.body);
    const legacyPin = await post({ body: 'Old client', region: { x: 0.4, y: 0.4, w: 0, h: 0 } });
    assert.equal(legacyPin.json().annotation.shape, 'pin');

    for (const [label, body] of [
      ['point outside the unit square', { body: 'x', shape: 'pen', points: [[0.1, 0.1], [1.01, 0.5]] }],
      ['point with three coordinates', { body: 'x', shape: 'pen', points: [[0.1, 0.1, 0.1], [0.2, 0.2]] }],
      ['501 points', { body: 'x', shape: 'pen', points: Array.from({ length: 501 }, () => [0.5, 0.5]) }],
      ['a one-point stroke', { body: 'x', shape: 'pen', points: [[0.5, 0.5]] }],
      ['a three-point arrow', { body: 'x', shape: 'arrow', points: [[0, 0], [0.5, 0.5], [1, 1]] }],
      ['a string coordinate', { body: 'x', shape: 'pen', points: [['0.1', 0.1], [0.2, 0.2]] }],
      ['an unknown shape', { body: 'x', shape: 'circle', region: { x: 0, y: 0, w: 0.1, h: 0.1 } }],
      ['an unknown color', { body: 'x', shape: 'rect', region: { x: 0, y: 0, w: 0.1, h: 0.1 }, color: '#ff0000' }],
      ['a zero-size area', { body: 'x', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0, h: 0.1 } }],
      ['a stroke with a region', { body: 'x', shape: 'pen', points: [[0, 0], [1, 1]], region: { x: 0, y: 0, w: 1, h: 1 } }],
      ['points without a shape', { body: 'x', points: [[0, 0], [1, 1]] }],
      ['a color without a shape', { body: 'x', color: 'red' }],
      ['a shape with a page on an image', { body: 'x', shape: 'rect', region: { x: 0, y: 0, w: 0.1, h: 0.1 }, pageNumber: 1 }],
    ]) {
      assert.equal((await post(body)).statusCode, 400, label);
    }
    assert.equal(db.tables.reviewAnnotation.length, 4);

    // PDF shapes need their page; video shapes need their frame's timecode.
    const pdf = await createSession({ attachmentId: 'pdf-a', title: 'Brochure' });
    assert.equal((await post({ body: 'p2', pageNumber: 2, shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, pdf.id)).statusCode, 201);
    assert.equal((await post({ body: 'no page', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, pdf.id)).statusCode, 400);
    const video = await createSession({ attachmentId: 'video-a', title: 'Walkthrough' });
    const frame = await post({ body: 'frame', timecodeMs: 4200, shape: 'arrow', points: [[0.1, 0.1], [0.3, 0.3]] }, video.id);
    assert.equal(frame.statusCode, 201, frame.body);
    assert.deepEqual([frame.json().annotation.timecodeMs, frame.json().annotation.shape], [4200, 'arrow']);
    assert.equal((await post({ body: 'no frame', shape: 'arrow', points: [[0.1, 0.1], [0.3, 0.3]] }, video.id)).statusCode, 400);
  });

  it('lets a share-link guest draw shapes too, with the same rules', async (t) => {
    const { staff, guest, createSession } = await setup(t);
    const session = await createSession();
    const link = await staff('teamA', 'POST', `/${session.id}/share-links`, {}, { reauth: true });
    const { token } = link.json();
    const drawn = await guest('POST', `${token}/annotations`, { name: 'Casey', body: 'This', shape: 'pen', points: [[0.1, 0.1], [0.2, 0.2]], color: 'green' });
    assert.equal(drawn.statusCode, 201, drawn.body);
    assert.equal(drawn.json().annotation.color, 'green');
    assert.equal((await guest('POST', `${token}/annotations`, { name: 'Casey', body: 'x', shape: 'pen', points: [[0.1, 0.1], [2, 0.2]] })).statusCode, 400);
    const view = (await guest('GET', token)).json();
    assert.deepEqual(view.annotations[0].points, [[0.1, 0.1], [0.2, 0.2]]);
  });
});

describe('review tracking', () => {
  it('notifies @mentioned active teammates only, and refuses anyone else', async (t) => {
    const { staff, createSession, notifications } = await setup(t);
    const session = await createSession();
    const mention = await staff('teamA', 'POST', `/${session.id}/annotations`, { body: '@Avery can you check?', mentionUserIds: ['admin-a', 'team-a'] });
    assert.equal(mention.statusCode, 201, mention.body);
    // The author is never notified about their own comment.
    assert.deepEqual(notifications.map((n) => [n.userId, n.type, n.data.reviewSessionId]), [['admin-a', 'MENTION', session.id]]);
    assert.match(notifications[0].message, /Terry Team mentioned you on "Homepage"/);

    for (const ids of [['retired-a'], ['client-user-a'], ['admin-b'], ['nobody']]) {
      const refused = await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'x', mentionUserIds: ids });
      assert.deepEqual([refused.statusCode, refused.json().code], [400, 'INVALID_MENTION'], ids[0]);
    }
    assert.equal(notifications.length, 1);
  });

  it('notifies the session owner about share-link comments and decisions', async (t) => {
    const { staff, guest, createSession, notifications } = await setup(t);
    const session = await createSession({}, 'teamA');
    const { token } = (await staff('adminA', 'POST', `/${session.id}/share-links`, { allowDecision: true }, { reauth: true })).json();
    await guest('POST', `${token}/annotations`, { name: 'Casey', body: 'Looks good' });
    await guest('POST', `${token}/decisions`, { name: 'Casey', decision: 'approved' });
    assert.deepEqual(notifications.map((n) => [n.userId, n.type]), [['team-a', 'REVIEW_COMMENT'], ['team-a', 'REVIEW_DECISION']]);
    assert.equal(notifications[0].data.reviewSessionId, session.id);
  });

  it('lists every version, oldest first, on each version', async (t) => {
    const { staff, createSession } = await setup(t);
    const v1 = await createSession();
    const v2 = await createSession({ previousSessionId: v1.id, title: 'Homepage v2' });
    const v3 = await createSession({ previousSessionId: v2.id, title: 'Homepage v3' });
    for (const id of [v1.id, v2.id, v3.id]) {
      const versions = (await staff('teamA', 'GET', `/${id}`)).json().versions;
      assert.deepEqual(versions.map((v) => [v.id, v.version, v.status]), [[v1.id, 1, 'closed'], [v2.id, 2, 'closed'], [v3.id, 3, 'open']]);
    }
  });

  it('turns client portal decisions on and off, audited, only while open', async (t) => {
    const { staff, db, createSession } = await setup(t);
    const session = await createSession();
    assert.equal(session.clientCanDecide, false);
    const on = await staff('teamA', 'POST', `/${session.id}/client-access`, { clientCanDecide: true });
    assert.deepEqual([on.statusCode, on.json().clientCanDecide], [200, true]);
    await staff('teamA', 'POST', `/${session.id}/client-access`, { clientCanDecide: true });
    assert.equal(db.tables.auditEvent.filter((event) => event.action === 'review.client_access_changed').length, 1);
    assert.equal((await staff('teamA', 'GET', `/${session.id}`)).json().session.clientCanDecide, true);
    assert.equal((await staff('adminB', 'POST', `/${session.id}/client-access`, { clientCanDecide: false })).statusCode, 404);
    await createSession({ previousSessionId: session.id });
    assert.equal((await staff('teamA', 'POST', `/${session.id}/client-access`, { clientCanDecide: false })).statusCode, 409);
  });
});

describe('web page review', () => {
  it('is off unless enabled: 503 with a clear code, and capabilities say so', async (t) => {
    const { staff, captures } = await setup(t);
    assert.deepEqual((await staff('teamA', 'GET', '/capabilities')).json().webCapture.enabled, false);
    const refused = await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'https://example.com/', title: 'Site' });
    assert.deepEqual([refused.statusCode, refused.json().code], [503, 'WEB_REVIEW_CAPTURE_DISABLED']);
    assert.equal(captures.length, 0);
  });

  it('captures a page into a project attachment and a review session with its source', async (t) => {
    const { staff, db, captures, uploadDir } = await setup(t, { webCaptureEnabled: true });
    assert.equal((await staff('teamA', 'GET', '/capabilities')).json().webCapture.enabled, true);
    const created = await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'https://example.com/pricing#plans', viewport: 'mobile', title: 'Pricing' });
    assert.equal(created.statusCode, 201, created.body);
    const { session } = created.json();
    assert.deepEqual([session.sourceUrl, session.captureViewport, session.version, session.media.kind], ['https://example.com/pricing', 'mobile', 1, 'image']);
    assert.deepEqual(captures, [{ url: 'https://example.com/pricing#plans', viewport: 'mobile' }]);
    const attachment = db.tables.attachment.find((row) => row.id === session.attachmentId);
    assert.deepEqual([attachment.entityType, attachment.entityId, attachment.mimeType, attachment.organizationId], ['PROJECT', 'project-a', 'image/png', 'org-a']);
    assert.match(attachment.originalName, /^example\.com-mobile-\d{4}-\d{2}-\d{2}\.png$/);
    assert.deepEqual(fs.readFileSync(path.join(uploadDir, attachment.filename)), PNG);
    const event = db.tables.auditEvent.find((row) => row.action === 'review.session_created');
    assert.deepEqual([event.metadata.sourceHost, event.metadata.captureViewport], ['example.com', 'mobile']);

    // Another organization's project is not reachable.
    assert.equal((await staff('teamA', 'POST', '/capture', { projectId: 'project-b', url: 'https://example.com/', title: 'x' })).statusCode, 404);
    // The body is validated before anything is captured.
    assert.equal((await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'not a url', title: 'x' })).statusCode, 400);
    assert.equal((await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'https://example.com/', title: 'x', viewport: 'tablet' })).statusCode, 400);
    assert.equal(captures.length, 1);
  });

  it('recaptures as the next version, closing the previous one', async (t) => {
    const { staff, captures, createSession } = await setup(t, { webCaptureEnabled: true });
    const v1 = (await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'https://example.com/', title: 'Home' })).json().session;
    const v2 = await staff('teamA', 'POST', `/${v1.id}/recapture`, { viewport: 'mobile' });
    assert.equal(v2.statusCode, 201, v2.body);
    assert.deepEqual(
      [v2.json().session.version, v2.json().session.previousSessionId, v2.json().session.sourceUrl, v2.json().session.captureViewport, v2.json().session.title],
      [2, v1.id, 'https://example.com/', 'mobile', 'Home'],
    );
    assert.deepEqual(captures.map((c) => c.viewport), ['desktop', 'mobile']);
    assert.equal((await staff('teamA', 'GET', `/${v1.id}`)).json().session.status, 'closed');
    // Only the newest version can be recaptured, and only web captures.
    assert.equal((await staff('teamA', 'POST', `/${v1.id}/recapture`, {})).statusCode, 409);
    const upload = await createSession();
    const notWeb = await staff('teamA', 'POST', `/${upload.id}/recapture`, {});
    assert.deepEqual([notWeb.statusCode, notWeb.json().code], [422, 'NOT_A_WEB_CAPTURE']);
  });

  it('passes capture refusals through with their status and code, and stores nothing', async (t) => {
    const refusal = new WebCaptureError('WEB_CAPTURE_URL_REJECTED', 'Only public web pages can be captured.', 422);
    const { staff, db } = await setup(t, { webCaptureEnabled: true, captureWebPage: async () => { throw refusal; } });
    const response = await staff('teamA', 'POST', '/capture', { projectId: 'project-a', url: 'http://169.254.169.254/latest', title: 'x' });
    assert.deepEqual([response.statusCode, response.json()], [422, { error: 'Only public web pages can be captured.', code: 'WEB_CAPTURE_URL_REJECTED' }]);
    assert.equal(db.tables.reviewSession.length, 0);
    assert.equal(db.tables.attachment.filter((row) => row.mimeType === 'image/png' && row.id.startsWith('attachment-')).length, 0);
  });
});
