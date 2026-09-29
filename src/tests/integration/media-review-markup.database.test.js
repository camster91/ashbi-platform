// Real-database proof for review markup and client portal reviews
// (docs/media-review.md "Markup" and "Client portal reviews"):
//   - a signed-in client portal user reaches only review sessions of their
//     own client's projects: another client in the same organization, and
//     another organization, are invisible and cannot be annotated or decided;
//   - shape geometry is validated by the API and by the CHECK constraints of
//     migration 20260929120000_review_markup.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { default: reviewRoutes } = await import('../../routes/review.routes.js');
const { default: clientPortalReviewRoutes } = await import('../../routes/client-portal-review.routes.js');
const { withSession } = await import('../helpers/reauth.js');
const { purgeFixtureAuditEvents } = await import('../helpers/audit-cleanup.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
// Fixture credentials are built at runtime (never a literal secret).
const fixturePassword = () => ['fixture', randomUUID()].join(':');

test('client portal reviews stay inside the client, and markup geometry is enforced by the database', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `markup-org-a-${suffix}`;
  const orgB = `markup-org-b-${suffix}`;
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Markup Tenant A', slug: `markup-a-${suffix}` },
      { id: orgB, name: 'Markup Tenant B', slug: `markup-b-${suffix}` },
    ] });
    const staffA = await raw.user.create({ data: { organizationId: orgA, email: `markup-staff-a-${suffix}@example.com`, name: 'Staff A', password: fixturePassword(), role: 'ADMIN' } });
    const staffB = await raw.user.create({ data: { organizationId: orgB, email: `markup-staff-b-${suffix}@example.com`, name: 'Staff B', password: fixturePassword(), role: 'ADMIN' } });

    // Three clients: A1 and A2 in organization A, B1 in organization B, each
    // with a project, an image, a portal contact and a CLIENT user.
    const fixtures = {};
    for (const [key, org, uploader] of [['a1', orgA, staffA], ['a2', orgA, staffA], ['b1', orgB, staffB]]) {
      const client = await raw.client.create({ data: { organizationId: org, name: `Client ${key}` } });
      const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: `Site ${key}` } });
      const image = await raw.attachment.create({ data: {
        organizationId: org, filename: `markup-${key}-${suffix}.png`, originalName: `${key}.png`, mimeType: 'image/png', size: 10,
        path: `/uploads/markup-${key}-${suffix}.png`, entityType: 'PROJECT', entityId: project.id, uploadedById: uploader.id,
      } });
      const pdf = await raw.attachment.create({ data: {
        organizationId: org, filename: `markup-${key}-${suffix}.pdf`, originalName: `${key}.pdf`, mimeType: 'application/pdf', size: 10,
        path: `/uploads/markup-${key}-${suffix}.pdf`, entityType: 'PROJECT', entityId: project.id, uploadedById: uploader.id,
      } });
      const email = `markup-contact-${key}-${suffix}@example.com`;
      const contact = await raw.contact.create({ data: { clientId: client.id, name: `Contact ${key.toUpperCase()}`, email } });
      const user = await raw.user.create({ data: { organizationId: org, clientId: client.id, email, name: contact.name, password: fixturePassword(), role: 'CLIENT' } });
      fixtures[key] = { client, project, image, pdf, contact, user, org };
    }

    app = Fastify();
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.decorate('authenticate', async (request, reply) => {
      const user = { a: staffA, b: staffB }[request.headers['x-test-staff']];
      if (!user) return reply.status(401).send({ error: 'Unauthorized' });
      request.user = withSession({ id: user.id, role: user.role, organizationId: user.organizationId, name: user.name, email: user.email });
      request.prisma = createScopedPrisma(raw, user.organizationId);
      return undefined;
    });
    // The principal the client portal's clientAuth resolves from the session
    // (user, contact, client, organization), with the raw client the
    // tenancy-exempt prefix gets.
    async function clientAuth(request, reply) {
      const fixture = fixtures[request.headers['x-test-client']];
      if (!fixture) return reply.status(401).send({ error: 'Missing token' });
      request.clientUser = { id: fixture.user.id, role: 'CLIENT', contactId: fixture.contact.id, clientId: fixture.client.id, organizationId: fixture.org };
      request.prisma = raw;
      return undefined;
    }
    await app.register(reviewRoutes, { prefix: '/api/reviews' });
    await app.register(async (portal) => {
      await portal.register(clientPortalReviewRoutes, { prefix: '/reviews', clientAuth });
    }, { prefix: '/api/client-portal' });

    const staff = (key, method, url, payload) => app.inject({ method, url: `/api/reviews${url}`, payload, headers: { 'x-test-staff': key } });
    const client = (key, method, url, payload) => app.inject({ method, url: `/api/client-portal/reviews${url}`, payload, headers: { 'x-test-client': key } });
    const session = async (staffKey, fixture, attachment, title) => {
      const response = await staff(staffKey, 'POST', '', { projectId: fixture.project.id, attachmentId: attachment.id, title });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().session;
    };

    const a1 = await session('a', fixtures.a1, fixtures.a1.image, 'A1 homepage');
    const a2 = await session('a', fixtures.a2, fixtures.a2.image, 'A2 homepage');
    const b1 = await session('b', fixtures.b1, fixtures.b1.image, 'B1 homepage');
    for (const id of [a1.id, a2.id, b1.id]) {
      assert.equal((await staff(id === b1.id ? 'b' : 'a', 'POST', `/${id}/client-access`, { clientCanDecide: true })).statusCode, 200);
    }
    await staff('a', 'POST', `/${a2.id}/annotations`, { body: 'Internal to client A2', shape: 'rect', region: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });

    // ── Client scoping ──────────────────────────────────────────────────────
    const listA1 = (await client('a1', 'GET', '')).json().sessions;
    assert.deepEqual(listA1.map((row) => row.id), [a1.id]);
    assert.deepEqual((await client('a1', 'GET', `?projectId=${fixtures.a2.project.id}`)).json().sessions, []);
    assert.deepEqual((await client('b1', 'GET', '')).json().sessions.map((row) => row.id), [b1.id]);

    for (const foreign of [a2.id, b1.id]) {
      assert.equal((await client('a1', 'GET', `/${foreign}`)).statusCode, 404, 'view');
      assert.equal((await client('a1', 'GET', `/${foreign}/file`)).statusCode, 404, 'file');
      assert.equal((await client('a1', 'POST', `/${foreign}/annotations`, { body: 'cross-client write' })).statusCode, 404, 'annotate');
      assert.equal((await client('a1', 'POST', `/${foreign}/decisions`, { decision: 'approved' })).statusCode, 404, 'decide');
    }
    assert.equal(await raw.reviewAnnotation.count({ where: { sessionId: { in: [a2.id, b1.id] }, authorType: 'client' } }), 0);
    assert.equal(await raw.reviewDecision.count({ where: { sessionId: { in: [a2.id, b1.id] } } }), 0);
    assert.deepEqual(
      (await raw.reviewSession.findMany({ where: { id: { in: [a2.id, b1.id] } }, select: { status: true } })).map((row) => row.status),
      ['open', 'open'],
    );
    // A reply cannot hang off another client's comment either.
    const foreignComment = await raw.reviewAnnotation.findFirst({ where: { sessionId: a2.id } });
    assert.equal((await client('a1', 'POST', `/${a1.id}/annotations`, { body: 'x', parentId: foreignComment.id })).statusCode, 404);

    // Own session: view, comment with a shape, decide.
    const view = await client('a1', 'GET', `/${a1.id}`);
    assert.equal(view.statusCode, 200);
    for (const leaked of [a2.id, b1.id, fixtures.a2.client.id, orgA, staffA.id, fixtures.a1.image.path]) {
      assert.equal(view.body.includes(leaked), false, `client view leaked ${leaked}`);
    }
    const comment = await client('a1', 'POST', `/${a1.id}/annotations`, { body: 'Swap this photo', shape: 'pen', points: [[0.2, 0.3], [0.3, 0.35], [0.4, 0.3]], color: 'purple' });
    assert.equal(comment.statusCode, 201, comment.body);
    const stored = await raw.reviewAnnotation.findUnique({ where: { id: comment.json().annotation.id } });
    assert.deepEqual(
      [stored.authorType, stored.authorUserId, stored.authorName, stored.shape, stored.points, stored.color, stored.regionX, stored.regionW],
      ['client', fixtures.a1.user.id, 'Contact A1', 'pen', [[0.2, 0.3], [0.3, 0.35], [0.4, 0.3]], 'purple', 0.2, 0.2],
    );
    const decided = await client('a1', 'POST', `/${a1.id}/decisions`, { decision: 'approved' });
    assert.equal(decided.statusCode, 201, decided.body);
    const decisionRow = await raw.reviewDecision.findFirst({ where: { sessionId: a1.id } });
    assert.deepEqual([decisionRow.actorType, decisionRow.actorUserId, decisionRow.shareLinkId], ['client', fixtures.a1.user.id, null]);
    const event = await raw.auditEvent.findFirst({ where: { organizationId: orgA, action: 'review.decision_recorded' } });
    assert.deepEqual([event.actorType, event.actorUserId, event.metadata.via], ['CLIENT', fixtures.a1.user.id, 'client_portal']);

    // A trashed project's reviews disappear from the portal.
    await raw.project.update({ where: { id: fixtures.a1.project.id }, data: { deletedAt: new Date() } });
    assert.equal((await client('a1', 'GET', `/${a1.id}`)).statusCode, 404);
    await raw.project.update({ where: { id: fixtures.a1.project.id }, data: { deletedAt: null } });

    // ── Shape validation, API ───────────────────────────────────────────────
    const pdfSession = await session('a', fixtures.a1, fixtures.a1.pdf, 'Brochure');
    const post = (body) => staff('a', 'POST', `/${pdfSession.id}/annotations`, body);
    assert.equal((await post({ body: 'p3 area', pageNumber: 3, shape: 'rect', region: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } })).statusCode, 201);
    assert.equal((await post({ body: 'p3 arrow', pageNumber: 3, shape: 'arrow', points: [[0, 1], [1, 0]] })).statusCode, 201);
    for (const bad of [
      { body: 'no page', shape: 'rect', region: { x: 0.5, y: 0.5, w: 0.25, h: 0.25 } },
      { body: 'outside', pageNumber: 1, shape: 'pen', points: [[0.5, 0.5], [0.5, 1.5]] },
      { body: 'overflow', pageNumber: 1, shape: 'rect', region: { x: 0.9, y: 0.5, w: 0.25, h: 0.25 } },
      { body: 'too many', pageNumber: 1, shape: 'pen', points: Array.from({ length: 501 }, () => [0.5, 0.5]) },
      { body: 'arrow of three', pageNumber: 1, shape: 'arrow', points: [[0, 0], [0.5, 0.5], [1, 1]] },
    ]) {
      assert.equal((await post(bad)).statusCode, 400, bad.body);
    }
    assert.equal(await raw.reviewAnnotation.count({ where: { sessionId: pdfSession.id } }), 2);

    // ── Shape validation, database CHECK constraints ────────────────────────
    const base = { sessionId: pdfSession.id, authorType: 'staff', authorUserId: staffA.id, authorName: 'x', body: 'x' };
    const box = { regionX: 0.1, regionY: 0.1, regionW: 0.2, regionH: 0.2 };
    const check = /check constraint|violates|_check/i;
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'circle' } }), check);
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, shape: 'rect' } }), check, 'a shape needs a region');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pin' } }), check, 'a pin has no size');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, regionX: 0.1, regionY: 0.1, regionW: 0, regionH: 0, shape: 'rect' } }), check, 'an area has a size');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen' } }), check, 'a stroke needs points');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'rect', points: [[0, 0], [1, 1]] } }), check, 'an area has no points');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'arrow', points: [[0, 0], [0.5, 0.5], [1, 1]] } }), check, 'an arrow has two points');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: [[0, 0], [1, 1.5]] } }), check, 'points within 0..1');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: [[0, 0], ['a', 1]] } }), check, 'numeric points');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: [[0, 0], [1]] } }), check, 'pairs');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: { x: 1 } } }), check, 'an array');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: Array.from({ length: 501 }, () => [0.5, 0.5]) } }), check, 'at most 500');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, color: 'red' } }), check, 'a color needs a shape');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'rect', color: 'pink' } }), check, 'palette colors only');
    await assert.rejects(raw.reviewAnnotation.create({ data: { ...base, authorType: 'client', authorUserId: null } }), check, 'a client author is a user');
    await assert.rejects(raw.reviewSession.update({ where: { id: pdfSession.id }, data: { sourceUrl: 'https://example.com/' } }), check, 'source URL and viewport together');
    await assert.rejects(raw.reviewSession.update({ where: { id: pdfSession.id }, data: { sourceUrl: 'javascript:alert(1)', captureViewport: 'desktop' } }), check);
    await assert.rejects(raw.reviewSession.update({ where: { id: pdfSession.id }, data: { sourceUrl: 'https://example.com/', captureViewport: 'tablet' } }), check);
    // A valid stroke straight into the table is accepted.
    const direct = await raw.reviewAnnotation.create({ data: { ...base, ...box, shape: 'pen', points: [[0.1, 0.1], [0.3, 0.3]], color: 'green' } });
    assert.equal(direct.shape, 'pen');
  } finally {
    await app?.close();
    await raw.reviewSession.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.attachment.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (await purgeFixtureAuditEvents(raw, { ids: [orgA, orgB] })) {
      await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    }
    await raw.$disconnect();
  }
});
