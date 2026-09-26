// Media review staff API and client share links (#417 slice 1,
// docs/media-review.md), against an in-memory database wrapped by the real
// tenant proxy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const { setMediaScanner } = await import('../../services/media-scan.service.js');
const { hashShareToken } = await import('../../services/media-review.service.js');

const USERS = {
  adminA: { id: 'admin-a', role: 'ADMIN', organizationId: 'org-a', name: 'Avery Admin', email: 'avery@a.test' },
  teamA: { id: 'team-a', role: 'TEAM', organizationId: 'org-a', name: 'Terry Team', email: 'terry@a.test' },
  adminB: { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b', name: 'Blake Admin', email: 'blake@b.test' },
  botA: { id: 'bot-a', role: 'BOT', organizationId: 'org-a', name: 'Bot' },
};

async function setup(t) {
  const db = seedReviewOrganizations(createFakeReviewDb());
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/portal/')) request.prisma = db; // tenancy-exempt: raw client
  });
  app.decorate('authenticate', async (request, reply) => {
    const user = USERS[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = withSession(user);
    request.prisma = createScopedPrisma(db, user.organizationId);
    return undefined;
  });
  await app.register(reviewRoutes, { prefix: '/api/reviews' });
  await app.register(reviewPortalRoutes, { prefix: '/api/portal/review' });
  t.after(() => app.close());

  const staff = (key, method, url, payload, { reauth = false } = {}) => app.inject({
    method, url: `/api/reviews${url}`, payload, headers: key ? { 'x-test-user': key } : {}, cookies: key && reauth ? reauthCookies(USERS[key]) : {},
  });
  const guest = (method, url, payload) => app.inject({ method, url: `/api/portal/review/${url}`, payload });
  const createSession = async (key = 'teamA', body = {}) => {
    const suffix = USERS[key].organizationId.slice(-1);
    const response = await staff(key, 'POST', '', { projectId: `project-${suffix}`, attachmentId: `image-${suffix}`, title: 'Homepage v1', ...body });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().session;
  };
  const createLink = async (sessionId, key = 'teamA', body = {}) => {
    const response = await staff(key, 'POST', `/${sessionId}/share-links`, body, { reauth: true });
    assert.equal(response.statusCode, 201, response.body);
    return response.json();
  };
  return { db, app, staff, guest, createSession, createLink };
}

describe('media review staff API', () => {
  it('requires a staff session and refuses non-staff principals', async (t) => {
    const { staff } = await setup(t);
    assert.equal((await staff(null, 'GET', '?projectId=project-a')).statusCode, 401);
    assert.equal((await staff('botA', 'GET', '?projectId=project-a')).statusCode, 403);
  });

  it('creates a session for a reviewable project attachment and audits it', async (t) => {
    const { staff, db, createSession } = await setup(t);
    const session = await createSession();
    assert.deepEqual(
      [session.status, session.version, session.media.kind, session.media.fileName],
      ['open', 1, 'image', 'Homepage.png'],
    );
    assert.equal(db.tables.reviewSession[0].organizationId, 'org-a');
    const [event] = db.tables.auditEvent;
    assert.equal(event.action, 'review.session_created');
    assert.deepEqual(event.metadata, { projectId: 'project-a', attachmentId: 'image-a', version: 1, previousSessionId: null, mediaKind: 'image' });

    const list = (await staff('adminA', 'GET', '?projectId=project-a')).json().sessions;
    assert.deepEqual(list.map((row) => row.id), [session.id]);

    const sheet = await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'sheet-a', title: 'Budget' });
    assert.equal(sheet.statusCode, 422);
  });

  it('cannot reach another organization\'s project, file or session', async (t) => {
    const { staff, createSession, db } = await setup(t);
    const foreign = await staff('teamA', 'POST', '', { projectId: 'project-b', attachmentId: 'image-b', title: 'x' });
    assert.equal(foreign.statusCode, 404);
    const mixed = await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'image-b', title: 'x' });
    assert.equal(mixed.statusCode, 404);
    const sessionB = await createSession('adminB');
    for (const [method, url, body] of [
      ['GET', `/${sessionB.id}`],
      ['GET', `/${sessionB.id}/share-links`],
      ['POST', `/${sessionB.id}/annotations`, { body: 'hi' }],
      ['POST', `/${sessionB.id}/decisions`, { decision: 'approved' }],
    ]) {
      assert.equal((await staff('adminA', method, url, body)).statusCode, 404, `${method} ${url}`);
    }
    assert.equal((await staff('adminA', 'GET', '?projectId=project-b')).statusCode, 404);
    assert.equal(db.tables.reviewAnnotation.length, 0);
    assert.equal(db.tables.reviewDecision.length, 0);
  });

  it('threads annotations, checks anchors against the media kind, and resolves', async (t) => {
    const { staff, createSession } = await setup(t);
    const session = await createSession();
    const pinned = await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'Logo too small‮', region: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } });
    assert.equal(pinned.statusCode, 201, pinned.body);
    const annotation = pinned.json().annotation;
    assert.deepEqual([annotation.body, annotation.authorName, annotation.authorType], ['Logo too small', 'Terry Team', 'staff']);
    assert.deepEqual(annotation.region, { x: 0.1, y: 0.2, w: 0.3, h: 0.1 });

    assert.equal((await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'x', timecodeMs: 1000 })).statusCode, 400);
    assert.equal((await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'x', pageNumber: 2 })).statusCode, 400);
    assert.equal((await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'x', region: { x: 0.9, y: 0, w: 0.5, h: 0.1 } })).statusCode, 400);
    assert.equal((await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'x'.repeat(5001) })).statusCode, 400);
    assert.equal((await staff('teamA', 'POST', `/${session.id}/annotations`, { body: '<b>x</b>', extra: 1 })).statusCode, 400);

    const reply = await staff('adminA', 'POST', `/${session.id}/annotations`, { body: 'Agreed', parentId: annotation.id });
    assert.equal(reply.statusCode, 201);
    const nested = await staff('adminA', 'POST', `/${session.id}/annotations`, { body: 'Too deep', parentId: reply.json().annotation.id });
    assert.equal(nested.statusCode, 404);
    const anchoredReply = await staff('adminA', 'POST', `/${session.id}/annotations`, { body: 'x', parentId: annotation.id, region: { x: 0, y: 0, w: 0.1, h: 0.1 } });
    assert.equal(anchoredReply.statusCode, 400);

    const resolved = await staff('adminA', 'POST', `/${session.id}/annotations/${annotation.id}/resolve`, { resolved: true });
    assert.equal(resolved.json().annotation.resolved, true);
    assert.equal(resolved.json().annotation.resolvedById, 'admin-a');
    const reopened = await staff('adminA', 'POST', `/${session.id}/annotations/${annotation.id}/resolve`, { resolved: false });
    assert.equal(reopened.json().annotation.resolved, false);

    const detail = (await staff('teamA', 'GET', `/${session.id}`)).json();
    assert.equal(detail.annotations.length, 2);
  });

  it('records append-only decisions that set the session status', async (t) => {
    const { staff, db, createSession } = await setup(t);
    const session = await createSession();
    const changes = await staff('adminA', 'POST', `/${session.id}/decisions`, { decision: 'changes_requested', note: 'Swap hero' });
    assert.equal(changes.statusCode, 201);
    assert.equal(changes.json().status, 'changes_requested');
    const approve = await staff('adminA', 'POST', `/${session.id}/decisions`, { decision: 'approved' });
    assert.equal(approve.json().status, 'approved');
    assert.equal(db.tables.reviewDecision.length, 2);
    assert.equal(db.tables.reviewSession[0].status, 'approved');
    const events = db.tables.auditEvent.filter((event) => event.action === 'review.decision_recorded');
    assert.deepEqual(events.map((event) => [event.metadata.fromStatus, event.metadata.toStatus, event.metadata.via]), [
      ['open', 'changes_requested', 'staff'], ['changes_requested', 'approved', 'staff'],
    ]);
    // The tenant proxy refuses to rewrite a decision.
    await assert.rejects(
      createScopedPrisma(db, 'org-a').reviewDecision.update({ where: { id: db.tables.reviewDecision[0].id }, data: { decision: 'approved' } }),
      /append-only/,
    );
  });

  it('creates a new version linked to, and closing, the previous session', async (t) => {
    const { staff, createSession, createLink, guest } = await setup(t);
    const v1 = await createSession();
    const { token } = await createLink(v1.id);
    const v2 = await createSession('teamA', { attachmentId: 'video-a', title: 'Homepage v2', previousSessionId: v1.id });
    assert.deepEqual([v2.version, v2.previousSessionId], [2, v1.id]);
    const old = (await staff('teamA', 'GET', `/${v1.id}`)).json().session;
    assert.deepEqual([old.status, old.nextSessionId], ['closed', v2.id]);
    const again = await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'pdf-a', title: 'fork', previousSessionId: v1.id });
    assert.equal(again.statusCode, 409);
    // The closed session is read-only for staff and for its share link.
    assert.equal((await staff('teamA', 'POST', `/${v1.id}/annotations`, { body: 'late' })).statusCode, 409);
    assert.equal((await guest('GET', token)).statusCode, 200);
    assert.equal((await guest('POST', `${token}/annotations`, { name: 'Client', body: 'late' })).statusCode, 409);
  });

  it('refuses files the media scanner blocks or has not finished', async (t) => {
    const { staff } = await setup(t);
    t.after(() => setMediaScanner(null));
    setMediaScanner({ scan: async () => ({ verdict: 'blocked' }) });
    const blocked = await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'image-a', title: 'x' });
    assert.deepEqual([blocked.statusCode, blocked.json().code], [422, 'MEDIA_BLOCKED']);
    setMediaScanner({ scan: async () => { throw new Error('scanner down'); } });
    const pending = await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'image-a', title: 'x' });
    assert.deepEqual([pending.statusCode, pending.json().code], [409, 'MEDIA_SCAN_PENDING']);
  });
});

describe('media review share links', () => {
  it('require step-up re-authentication to create, and store only a hash', async (t) => {
    const { staff, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const denied = await staff('teamA', 'POST', `/${session.id}/share-links`, {});
    assert.deepEqual([denied.statusCode, denied.json().code], [403, 'REAUTH_REQUIRED']);
    assert.equal(db.tables.reviewShareLink.length, 0);

    const created = await createLink(session.id, 'teamA', { label: 'Client review', allowDecision: true });
    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(created.path, `/portal/review/${created.token}`);
    const [row] = db.tables.reviewShareLink;
    assert.equal(row.tokenHash, hashShareToken(created.token));
    assert.equal(JSON.stringify(row).includes(created.token), false);
    const days = (new Date(row.expiresAt) - new Date(row.createdAt)) / 86_400_000;
    assert.ok(Math.abs(days - 14) < 0.01, `default expiry is 14 days, got ${days}`);

    const event = db.tables.auditEvent.find((entry) => entry.action === 'review.share_link_created');
    assert.equal(JSON.stringify(event).includes(created.token), false);
    assert.equal(JSON.stringify(event).includes(row.tokenHash), false);
    assert.deepEqual([event.metadata.expiresInDays, event.metadata.allowDecision], [14, true]);

    const list = (await staff('teamA', 'GET', `/${session.id}/share-links`)).json().shareLinks;
    assert.equal(list.length, 1);
    assert.equal(JSON.stringify(list).includes(row.tokenHash), false);
    assert.equal(list[0].state, 'active');

    assert.equal((await staff('teamA', 'POST', `/${session.id}/share-links`, { expiresInDays: 91 }, { reauth: true })).statusCode, 400);
    const max = await createLink(session.id, 'teamA', { expiresInDays: 90 });
    assert.equal(max.shareLink.state, 'active');
  });

  it('shows a guest only the linked session, with no staff ids or emails', async (t) => {
    const { staff, guest, createSession, createLink } = await setup(t);
    const session = await createSession();
    await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'Staff note', region: { x: 0, y: 0, w: 0.5, h: 0.5 } });
    const { token } = await createLink(session.id);
    const view = await guest('GET', token);
    assert.equal(view.statusCode, 200);
    assert.equal(view.headers['cache-control'], 'no-store');
    assert.equal(view.headers['referrer-policy'], 'no-referrer');
    const body = view.json();
    assert.deepEqual(body.session, {
      title: 'Homepage v1', status: 'open', version: 1,
      media: { fileName: 'Homepage.png', mimeType: 'image/png', size: 1024, kind: 'image' },
    });
    assert.equal(body.link.allowDecision, false);
    const text = JSON.stringify(body);
    for (const secret of ['team-a', 'terry@a.test', 'project-a', 'image-a', '/uploads/', 'org-a', session.id]) {
      assert.equal(text.includes(secret), false, `public view leaked ${secret}`);
    }
  });

  it('lets a named guest comment, and decide only when the link allows it', async (t) => {
    const { guest, db, createSession, createLink } = await setup(t);
    const session = await createSession('teamA', { attachmentId: 'video-a' });
    const { token } = await createLink(session.id);
    const comment = await guest('POST', `${token}/annotations`, { name: '  Casey\u0000 Client ', email: 'Casey@Example.com', body: 'At 0:05 the logo flickers', timecodeMs: 5000 });
    assert.equal(comment.statusCode, 201, comment.body);
    const annotation = comment.json().annotation;
    assert.deepEqual([annotation.authorName, annotation.authorType, annotation.timecodeMs], ['Casey Client', 'guest', 5000]);
    assert.equal('authorEmail' in annotation, false);
    const row = db.tables.reviewAnnotation[0];
    assert.deepEqual([row.authorEmail, row.shareLinkId, row.authorUserId], ['casey@example.com', db.tables.reviewShareLink[0].id, undefined]);
    assert.equal((await guest('POST', `${token}/annotations`, { name: 'Casey', body: 'x', region: { x: 0, y: 0, w: 1, h: 1 } })).statusCode, 400);
    assert.equal((await guest('POST', `${token}/annotations`, { body: 'no name' })).statusCode, 400);
    assert.equal((await guest('POST', `${token}/annotations`, { name: 'Casey', email: 'not-an-email', body: 'x' })).statusCode, 400);

    const refused = await guest('POST', `${token}/decisions`, { name: 'Casey', decision: 'approved' });
    assert.equal(refused.statusCode, 403);
    assert.equal(db.tables.reviewDecision.length, 0);

    const { token: deciding } = await createLink(session.id, 'teamA', { allowDecision: true });
    const approved = await guest('POST', `${deciding}/decisions`, { name: 'Casey', decision: 'approved', note: 'Ship it' });
    assert.equal(approved.statusCode, 201, approved.body);
    assert.equal(db.tables.reviewSession[0].status, 'approved');
    const event = db.tables.auditEvent.find((entry) => entry.action === 'review.decision_recorded');
    assert.deepEqual([event.organizationId, event.actorType, event.actorUserId, event.metadata.via], ['org-a', 'CLIENT', null, 'share_link']);
    assert.equal(JSON.stringify(event).includes('Casey'), false);
  });

  it('denies malformed, unknown, expired and revoked tokens', async (t) => {
    const { staff, guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token, shareLink } = await createLink(session.id, 'teamA', { allowDecision: true });

    const unknown = 'A'.repeat(43);
    for (const bad of ['short', unknown, `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`]) {
      assert.equal((await guest('GET', bad)).statusCode, 404, bad);
      assert.equal((await guest('GET', `${bad}/file`)).statusCode, 404);
      assert.equal((await guest('POST', `${bad}/annotations`, { name: 'x', body: 'x' })).statusCode, 404);
      assert.equal((await guest('POST', `${bad}/decisions`, { name: 'x', decision: 'approved' })).statusCode, 404);
    }

    db.tables.reviewShareLink[0].expiresAt = new Date(Date.now() - 1000);
    const expired = await guest('GET', token);
    assert.deepEqual([expired.statusCode, expired.json().error], [410, 'This review link has expired']);
    assert.equal((await guest('POST', `${token}/annotations`, { name: 'x', body: 'x' })).statusCode, 410);
    db.tables.reviewShareLink[0].expiresAt = new Date(Date.now() + 86_400_000);
    assert.equal((await guest('GET', token)).statusCode, 200);

    const revoked = await staff('teamA', 'POST', `/${session.id}/share-links/${shareLink.id}/revoke`);
    assert.equal(revoked.json().shareLink.state, 'revoked');
    const gone = await guest('GET', token);
    assert.deepEqual([gone.statusCode, gone.json().error], [410, 'This review link has been revoked']);
    assert.equal((await guest('GET', `${token}/file`)).statusCode, 410);
    assert.equal((await guest('POST', `${token}/decisions`, { name: 'x', decision: 'approved' })).statusCode, 410);
    assert.equal(db.tables.reviewDecision.length, 0);
    assert.deepEqual(db.tables.auditEvent.filter((e) => e.action === 'review.share_link_revoked').map((e) => e.metadata), [{ sessionId: session.id, wasExpired: false }]);
    // Another organization cannot revoke it.
    assert.equal((await staff('adminB', 'POST', `/${session.id}/share-links/${shareLink.id}/revoke`)).statusCode, 404);
  });

  it('keeps a link inside its own session', async (t) => {
    const { guest, db, createSession, createLink, staff } = await setup(t);
    const sessionA1 = await createSession();
    const sessionA2 = await createSession('teamA', { attachmentId: 'video-a', title: 'Other' });
    const sessionB = await createSession('adminB');
    const { token } = await createLink(sessionA1.id);
    const other = await staff('teamA', 'POST', `/${sessionA2.id}/annotations`, { body: 'Other session', timecodeMs: 0 });
    const foreign = await staff('adminB', 'POST', `/${sessionB.id}/annotations`, { body: 'Tenant B' });

    const view = (await guest('GET', token)).json();
    assert.equal(view.session.title, 'Homepage v1');
    assert.equal(view.annotations.length, 0);

    // Replies may only target annotations of the linked session.
    for (const parentId of [other.json().annotation.id, foreign.json().annotation.id]) {
      const reply = await guest('POST', `${token}/annotations`, { name: 'x', body: 'x', parentId });
      assert.equal(reply.statusCode, 404);
    }
    assert.equal(db.tables.reviewAnnotation.filter((row) => row.authorType === 'guest').length, 0);
  });

  it('streams only the linked file, inline for media, with a sandbox CSP', async (t) => {
    const { guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    const dir = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'image-a.bin');
    const created = !fs.existsSync(file);
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    t.after(() => { if (created) fs.rmSync(file, { force: true }); });

    const response = await guest('GET', `${token}/file`);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.equal(response.headers['content-disposition'], 'inline; filename="Homepage.png"');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal(response.rawPayload.length, 7);

    db.tables.attachment.find((row) => row.id === 'image-a').path = '/uploads/quarantine/image-a.bin';
    assert.equal((await guest('GET', `${token}/file`)).statusCode, 404);
  });

  it('withholds a file from a deleted project', async (t) => {
    const { guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    db.tables.project.find((row) => row.id === 'project-a').deletedAt = new Date();
    assert.equal((await guest('GET', token)).statusCode, 404);
    assert.equal((await guest('GET', `${token}/file`)).statusCode, 404);
  });
});

describe('media review share-link rate limits', () => {
  it('limit one link across many addresses, keyed on the token hash', async (t) => {
    const { app, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    const { token: other } = await createLink(session.id);
    const view = (link, index) => app.inject({ method: 'GET', url: `/api/portal/review/${link}`, remoteAddress: `198.51.${Math.floor(index / 250)}.${index % 250}` });
    for (let index = 0; index < 120; index += 1) assert.equal((await view(token, index)).statusCode, 200);
    const limited = await view(token, 120);
    assert.deepEqual([limited.statusCode, limited.json().code], [429, 'SHARE_LINK_RATE_LIMITED']);
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal(limited.body.includes(token), false);
    // Another link has its own budget.
    assert.equal((await view(other, 121)).statusCode, 200);
  });

  it('limit guest comments per link from rotating addresses', async (t) => {
    const { app, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    const post = (index) => app.inject({ method: 'POST', url: `/api/portal/review/${token}/annotations`, payload: { name: 'Guest', body: `c${index}` }, remoteAddress: `203.0.113.${index}` });
    for (let index = 0; index < 30; index += 1) assert.equal((await post(index)).statusCode, 201);
    assert.equal((await post(31)).statusCode, 429);
    assert.equal(db.tables.reviewAnnotation.length, 30);
  });

  it('keep the per-IP limit for a single address', async (t) => {
    const { app, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    let status = 0;
    for (let index = 0; index < 21; index += 1) {
      status = (await app.inject({ method: 'POST', url: `/api/portal/review/${token}/annotations`, payload: { name: 'Guest', body: `c${index}` }, remoteAddress: '203.0.113.9' })).statusCode;
    }
    assert.equal(status, 429);
  });
});

describe('media review guest write bounds', () => {
  const seedAnnotations = (db, sessionId, count, extra = {}) => {
    const base = Date.now() - count * 1000;
    for (let index = 0; index < count; index += 1) {
      db.tables.reviewAnnotation.push({
        id: `seed-${sessionId}-${index}`, sessionId, parentId: null, authorType: 'staff', authorUserId: 'team-a', authorName: 'Seed',
        body: `seed ${index}`, createdAt: new Date(base + index * 1000), updatedAt: new Date(), ...extra,
      });
    }
  };

  it('caps comments per share link and per session with 409', async (t) => {
    const { staff, guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    const linkId = db.tables.reviewShareLink[0].id;
    seedAnnotations(db, session.id, 500, { authorType: 'guest', authorUserId: undefined, shareLinkId: linkId });
    const perLink = await guest('POST', `${token}/annotations`, { name: 'Guest', body: 'one more' });
    assert.deepEqual([perLink.statusCode, perLink.json().code], [409, 'ANNOTATION_LIMIT_REACHED']);
    // A fresh link still works until the session cap.
    const { token: second } = await createLink(session.id);
    assert.equal((await guest('POST', `${second}/annotations`, { name: 'Guest', body: 'fresh link' })).statusCode, 201);
    seedAnnotations(db, `${session.id}`, 1500);
    const perSession = await guest('POST', `${second}/annotations`, { name: 'Guest', body: 'over' });
    assert.deepEqual([perSession.statusCode, perSession.json().code], [409, 'ANNOTATION_LIMIT_REACHED']);
    const staffOver = await staff('teamA', 'POST', `/${session.id}/annotations`, { body: 'staff over' });
    assert.equal(staffOver.statusCode, 409);
  });

  it('shows the newest threads with their replies when a session has more than a page', async (t) => {
    const { guest, staff, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id);
    seedAnnotations(db, session.id, 510);
    const newest = db.tables.reviewAnnotation.at(-1);
    db.tables.reviewAnnotation.push({ id: 'reply-newest', sessionId: session.id, parentId: newest.id, authorType: 'staff', authorUserId: 'team-a', authorName: 'Seed', body: 'reply', createdAt: new Date(), updatedAt: new Date() });
    const view = (await guest('GET', token)).json();
    assert.equal(view.annotationTotal, 511);
    assert.equal(view.annotationsTruncated, true);
    const threads = view.annotations.filter((annotation) => !annotation.parentId);
    assert.equal(threads.length, 500);
    assert.equal(threads.at(-1).id, newest.id, 'the newest comment is always shown');
    assert.equal(threads.some((annotation) => annotation.id === `seed-${session.id}-0`), false);
    assert.ok(view.annotations.some((annotation) => annotation.id === 'reply-newest'));
    const detail = (await staff('teamA', 'GET', `/${session.id}`)).json();
    assert.equal(detail.annotations.length, 511);
    assert.equal(detail.annotationsTruncated, false);
  });

  it('records at most one decision per share link; staff can still decide', async (t) => {
    const { staff, guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id, 'teamA', { allowDecision: true });
    assert.equal((await guest('POST', `${token}/decisions`, { name: 'Casey', decision: 'changes_requested' })).statusCode, 201);
    const again = await guest('POST', `${token}/decisions`, { name: 'Casey', decision: 'approved' });
    assert.deepEqual([again.statusCode, again.json().code], [409, 'SHARE_LINK_DECISION_RECORDED']);
    const view = (await guest('GET', token)).json();
    assert.deepEqual([view.link.canDecide, view.link.decisionRecorded], [false, true]);
    assert.equal(db.tables.reviewSession[0].status, 'changes_requested');
    assert.equal((await staff('adminA', 'POST', `/${session.id}/decisions`, { decision: 'approved' })).statusCode, 201);
    assert.equal(db.tables.reviewDecision.length, 2);
  });

  it('never reopens a session closed after it was read (staff and share link)', async (t) => {
    const { staff, guest, db, createSession, createLink } = await setup(t);
    const session = await createSession();
    const { token } = await createLink(session.id, 'teamA', { allowDecision: true });
    db.tables.reviewSession[0].status = 'closed';
    // Both routes read a stale "open" session, then decide.
    const staleSession = db.reviewSession.findFirst;
    db.reviewSession.findFirst = async (args) => {
      const row = await staleSession(args);
      return row ? { ...row, status: 'open' } : row;
    };
    const staleLink = db.reviewShareLink.findUnique;
    db.reviewShareLink.findUnique = async (args) => {
      const row = await staleLink(args);
      return row?.session ? { ...row, session: { ...row.session, status: 'open' } } : row;
    };
    const staffDecision = await staff('adminA', 'POST', `/${session.id}/decisions`, { decision: 'approved' });
    assert.deepEqual([staffDecision.statusCode, staffDecision.json().code], [409, 'REVIEW_SESSION_CLOSED']);
    const guestDecision = await guest('POST', `${token}/decisions`, { name: 'Casey', decision: 'approved' });
    assert.deepEqual([guestDecision.statusCode, guestDecision.json().code], [409, 'REVIEW_SESSION_CLOSED']);
    assert.equal(db.tables.reviewSession[0].status, 'closed');
    assert.equal(db.tables.reviewDecision.length, 0, 'the decision was rolled back');
  });
});

