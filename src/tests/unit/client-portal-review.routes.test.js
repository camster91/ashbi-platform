// Client portal media review (docs/media-review.md "Client portal
// reviews"): a signed-in client user reaches only review sessions of their
// own client's projects, comments as their contact, and decides only when
// staff allowed it. The routes get the raw (unscoped) database, exactly as
// the tenancy-exempt /api/client-portal prefix does in the application.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';

const { default: reviewRoutes } = await import('../../routes/review.routes.js');
const { default: clientPortalReviewRoutes, CLIENT_REVIEW_LIMITS } = await import('../../routes/client-portal-review.routes.js');
const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { withSession } = await import('../helpers/reauth.js');
const { createFakeReviewDb, seedReviewOrganizations, seedPortalClients } = await import('../helpers/fake-review-db.js');

const STAFF = {
  teamA: { id: 'team-a', role: 'TEAM', organizationId: 'org-a', name: 'Terry Team', email: 'terry@a.test' },
  adminB: { id: 'admin-b', role: 'ADMIN', organizationId: 'org-b', name: 'Blake Admin', email: 'blake@b.test' },
};
// What clientAuth puts on the request after re-resolving the session.
const CLIENTS = {
  a: { id: 'user-client-a', contactId: 'contact-client-a', clientId: 'client-a', organizationId: 'org-a', role: 'CLIENT' },
  a2: { id: 'user-client-a2', contactId: 'contact-client-a2', clientId: 'client-a2', organizationId: 'org-a', role: 'CLIENT' },
  b: { id: 'user-client-b', contactId: 'contact-client-b', clientId: 'client-b', organizationId: 'org-b', role: 'CLIENT' },
};

async function setup(t) {
  const db = seedPortalClients(seedReviewOrganizations(createFakeReviewDb()));
  const notifications = [];
  const app = Fastify();
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorate('notify', async (userId, notification) => { notifications.push({ userId, ...notification }); });
  app.decorate('authenticate', async (request, reply) => {
    const user = STAFF[request.headers['x-test-staff']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = withSession(user);
    request.prisma = createScopedPrisma(db, user.organizationId);
    return undefined;
  });
  // Stand-in for the client portal's clientAuth (same name, so the route
  // inventory would classify it the same way).
  async function clientAuth(request, reply) {
    const principal = CLIENTS[request.headers['x-test-client']];
    if (!principal) return reply.status(401).send({ error: 'Missing token' });
    request.clientUser = { ...principal };
    request.prisma = db;
    return undefined;
  }
  await app.register(reviewRoutes, { prefix: '/api/reviews' });
  await app.register(async (portal) => {
    await portal.register(clientPortalReviewRoutes, { prefix: '/reviews', clientAuth });
  }, { prefix: '/api/client-portal' });
  t.after(() => app.close());

  const staff = (key, method, url, payload) => app.inject({ method, url: `/api/reviews${url}`, payload, headers: { 'x-test-staff': key } });
  const client = (key, method, url, payload) => app.inject({ method, url: `/api/client-portal/reviews${url}`, payload, headers: key ? { 'x-test-client': key } : {} });
  // Sessions are shared with the client unless a test says otherwise:
  // portal visibility is opt-in.
  const createSession = async (key, projectId, attachmentId, title, { share = true } = {}) => {
    const response = await staff(key, 'POST', '', { projectId, attachmentId, title });
    assert.equal(response.statusCode, 201, response.body);
    const session = response.json().session;
    assert.equal(session.sharedWithClient, false);
    if (share) assert.equal((await staff(key, 'POST', `/${session.id}/client-access`, { sharedWithClient: true })).statusCode, 200);
    return session;
  };
  return { db, staff, client, createSession, notifications };
}

describe('client portal reviews', () => {
  it('requires a client portal session', async (t) => {
    const { client, createSession } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    for (const [method, url, body] of [['GET', ''], ['GET', `/${session.id}`], ['GET', `/${session.id}/file`], ['POST', `/${session.id}/annotations`, { body: 'x' }], ['POST', `/${session.id}/decisions`, { decision: 'approved' }]]) {
      assert.equal((await client(null, method, url, body)).statusCode, 401, `${method} ${url}`);
    }
  });

  it('lists and opens only the sessions of the client\'s own projects', async (t) => {
    const { client, createSession, staff } = await setup(t);
    const mine = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    const otherClient = await createSession('teamA', 'project-a2', 'image-a2', 'Other client homepage');
    const otherOrg = await createSession('adminB', 'project-b', 'image-b', 'Tenant B homepage');
    await staff('teamA', 'POST', `/${mine.id}/annotations`, { body: 'Staff note', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });

    const list = await client('a', 'GET', '');
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().sessions.map((s) => [s.id, s.projectName, s.openAnnotationCount]), [[mine.id, 'Website A', 1]]);
    assert.equal(list.headers['cache-control'], 'no-store');
    assert.deepEqual((await client('a', 'GET', '?projectId=project-a2')).json().sessions, []);
    assert.deepEqual((await client('a2', 'GET', '')).json().sessions.map((s) => s.id), [otherClient.id]);

    const view = await client('a', 'GET', `/${mine.id}`);
    assert.equal(view.statusCode, 200);
    const body = view.json();
    assert.deepEqual([body.session.title, body.session.media.kind, body.permissions], ['Homepage', 'image', { canComment: true, canDecide: false }]);
    assert.deepEqual(body.annotations.map((a) => [a.body, a.authorType, a.shape]), [['Staff note', 'staff', 'rect']]);
    // No staff ids, storage paths, share-link ids or organization ids.
    const text = JSON.stringify(body);
    for (const secret of ['team-a', 'terry@a.test', '/uploads/', 'image-a.bin', 'org-a', 'authorUserId', 'viaShareLinkId']) {
      assert.equal(text.includes(secret), false, `client view leaked ${secret}`);
    }

    // Another client's session (same organization) and another organization's
    // session are indistinguishable from an unknown id, on every route.
    for (const id of [otherClient.id, otherOrg.id, 'missing-session']) {
      for (const [method, url, payload] of [
        ['GET', `/${id}`], ['GET', `/${id}/file`],
        ['POST', `/${id}/annotations`, { body: 'x' }],
        ['POST', `/${id}/decisions`, { decision: 'approved' }],
      ]) {
        assert.equal((await client('a', method, url, payload)).statusCode, 404, `${method} ${url}`);
      }
    }
  });

  it('shows only reviews staff shared with the client: unshared ones are 404 and unlisted', async (t) => {
    const { client, staff, createSession } = await setup(t);
    const shared = await createSession('teamA', 'project-a', 'image-a', 'Shared homepage');
    const internal = await createSession('teamA', 'project-a', 'video-a', 'Internal walkthrough', { share: false });
    await staff('teamA', 'POST', `/${internal.id}/annotations`, { body: 'Internal only' });

    assert.deepEqual((await client('a', 'GET', '')).json().sessions.map((s) => s.id), [shared.id]);
    for (const [method, url, payload] of [
      ['GET', `/${internal.id}`], ['GET', `/${internal.id}/file`],
      ['POST', `/${internal.id}/annotations`, { body: 'x' }],
      ['POST', `/${internal.id}/decisions`, { decision: 'approved' }],
    ]) {
      const response = await client('a', method, url, payload);
      assert.deepEqual([response.statusCode, response.json()], [404, { error: 'Review not found' }], `${method} ${url}`);
    }

    // Sharing makes it visible; unsharing hides it again.
    await staff('teamA', 'POST', `/${internal.id}/client-access`, { sharedWithClient: true });
    assert.equal((await client('a', 'GET', `/${internal.id}`)).statusCode, 200);
    assert.equal((await client('a', 'GET', '')).json().sessions.length, 2);
    await staff('teamA', 'POST', `/${internal.id}/client-access`, { sharedWithClient: false });
    assert.equal((await client('a', 'GET', `/${internal.id}`)).statusCode, 404);
    assert.deepEqual((await client('a', 'GET', '')).json().sessions.map((s) => s.id), [shared.id]);
  });

  it('hides reviews of a trashed project', async (t) => {
    const { client, db, createSession } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    db.tables.project.find((row) => row.id === 'project-a').deletedAt = new Date();
    assert.equal((await client('a', 'GET', `/${session.id}`)).statusCode, 404);
    assert.deepEqual((await client('a', 'GET', '')).json().sessions, []);
  });

  it('comments and replies as the signed-in contact, with shapes, and notifies the owner', async (t) => {
    const { client, db, createSession, notifications } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'video-a', 'Walkthrough');
    const posted = await client('a', 'POST', `/${session.id}/annotations`, { body: 'Logo flickers here', timecodeMs: 5000, shape: 'arrow', points: [[0.2, 0.2], [0.4, 0.4]], color: 'red' });
    assert.equal(posted.statusCode, 201, posted.body);
    const annotation = posted.json().annotation;
    assert.deepEqual([annotation.authorName, annotation.authorType, annotation.timecodeMs, annotation.shape], ['Contact of client-a', 'client', 5000, 'arrow']);
    const row = db.tables.reviewAnnotation.find((entry) => entry.id === annotation.id);
    assert.deepEqual([row.authorUserId, row.authorEmail, row.shareLinkId], ['user-client-a', 'client-a@clients.test', undefined]);
    assert.deepEqual(notifications.map((n) => [n.userId, n.type, n.data.reviewSessionId]), [['team-a', 'REVIEW_COMMENT', session.id]]);

    const reply = await client('a', 'POST', `/${session.id}/annotations`, { body: 'Also at the end', parentId: annotation.id });
    assert.equal(reply.statusCode, 201);
    // Shape rules apply; a name cannot be chosen; replies are one level deep.
    assert.equal((await client('a', 'POST', `/${session.id}/annotations`, { body: 'x', shape: 'arrow', points: [[0.2, 0.2], [0.4, 0.4]] })).statusCode, 400);
    assert.equal((await client('a', 'POST', `/${session.id}/annotations`, { body: 'x', name: 'Someone else' })).statusCode, 400);
    assert.equal((await client('a', 'POST', `/${session.id}/annotations`, { body: 'x', parentId: reply.json().annotation.id })).statusCode, 404);
  });

  it('decides only when staff allowed client decisions, and audits the decision', async (t) => {
    const { client, db, staff, createSession, notifications } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    const refused = await client('a', 'POST', `/${session.id}/decisions`, { decision: 'approved' });
    assert.deepEqual([refused.statusCode, refused.json().code], [403, 'CLIENT_DECISION_NOT_ALLOWED']);
    assert.equal(db.tables.reviewDecision.length, 0);

    await staff('teamA', 'POST', `/${session.id}/client-access`, { clientCanDecide: true });
    assert.deepEqual((await client('a', 'GET', `/${session.id}`)).json().permissions, { canComment: true, canDecide: true });
    const approved = await client('a', 'POST', `/${session.id}/decisions`, { decision: 'changes_requested', note: 'Bigger logo' });
    assert.equal(approved.statusCode, 201, approved.body);
    assert.equal(db.tables.reviewSession.find((row) => row.id === session.id).status, 'changes_requested');
    const [decision] = db.tables.reviewDecision;
    assert.deepEqual([decision.actorType, decision.actorUserId, decision.actorName, decision.shareLinkId], ['client', 'user-client-a', 'Contact of client-a', undefined]);
    const event = db.tables.auditEvent.find((entry) => entry.action === 'review.decision_recorded');
    assert.deepEqual([event.actorType, event.actorUserId, event.organizationId, event.metadata.via], ['CLIENT', 'user-client-a', 'org-a', 'client_portal']);
    assert.equal(notifications.at(-1).type, 'REVIEW_DECISION');

    // A closed (versioned) session is read-only.
    await staff('teamA', 'POST', '', { projectId: 'project-a', attachmentId: 'video-a', title: 'v2', previousSessionId: session.id });
    assert.equal((await client('a', 'POST', `/${session.id}/annotations`, { body: 'late' })).statusCode, 409);
    assert.equal((await client('a', 'POST', `/${session.id}/decisions`, { decision: 'approved' })).statusCode, 409);
    const versions = (await client('a', 'GET', `/${session.id}`)).json().versions;
    assert.deepEqual(versions.map((v) => v.version), [1, 2]);
  });

  it('serves only the session\'s own file', async (t) => {
    const { client, createSession } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    const uploads = path.join(process.cwd(), 'uploads');
    fs.mkdirSync(uploads, { recursive: true });
    const stored = path.join(uploads, 'image-a.bin');
    const existed = fs.existsSync(stored);
    if (!existed) fs.writeFileSync(stored, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    t.after(() => { if (!existed) fs.rmSync(stored, { force: true }); });
    const file = await client('a', 'GET', `/${session.id}/file`);
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/png');
    assert.equal(file.headers['x-content-type-options'], 'nosniff');
  });

  it('limits decisions per client user, whatever the address', async (t) => {
    const { client, staff, createSession } = await setup(t);
    const session = await createSession('teamA', 'project-a', 'image-a', 'Homepage');
    await staff('teamA', 'POST', `/${session.id}/client-access`, { clientCanDecide: true });
    for (let i = 0; i < CLIENT_REVIEW_LIMITS.decide.max; i += 1) {
      assert.equal((await client('a', 'POST', `/${session.id}/decisions`, { decision: 'approved' })).statusCode, 201);
    }
    const limited = await client('a', 'POST', `/${session.id}/decisions`, { decision: 'approved' });
    assert.deepEqual([limited.statusCode, limited.json().code], [429, 'CLIENT_REVIEW_RATE_LIMITED']);
    assert.ok(Number(limited.headers['retry-after']) > 0);
  });
});
