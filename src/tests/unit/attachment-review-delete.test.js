// A file under media review is approval evidence (#417, docs/media-review.md):
// neither the staff attachment route nor the client portal document route may
// delete it, even when a review starts between the check and the delete.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';

const { default: attachmentRoutes } = await import('../../routes/attachment.routes.js');
const { default: clientPortalRoutes } = await import('../../routes/client-portal.routes.js');
const { withSession } = await import('../helpers/reauth.js');

const DOC = { id: 'doc-1', entityType: 'PROJECT', entityId: 'proj-1', path: '/uploads/none-such-review-file.png', mimeType: 'image/png', size: 42, uploadedById: 'admin-1', filename: 'none-such-review-file.png' };

function fakeDb({ reviews = 0, deleteError = null } = {}) {
  const deleted = [];
  return {
    deleted,
    auditEvent: { create: async ({ data }) => ({ id: 'audit-1', ...data }) },
    attachment: {
      findUnique: async () => ({ ...DOC }),
      delete: async ({ where }) => {
        if (deleteError) throw deleteError;
        deleted.push(where.id);
        return {};
      },
    },
    reviewSession: { count: async ({ where }) => (where.attachmentId === DOC.id ? reviews : 0) },
    project: { findFirst: async () => ({ id: 'proj-1' }) },
    user: { findUnique: async () => PORTAL_USER },
    contact: { findFirst: async () => ({ id: 'contact-a', email: PORTAL_USER.email, clientId: 'client-a' }) },
    client: { findFirst: async () => ({ id: 'client-a', organizationId: 'org-a' }) },
  };
}

const PORTAL_USER = { id: 'portal-user', email: 'c@x.test', name: 'C', role: 'CLIENT', clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1 };
const FK_ERROR = Object.assign(new Error('Foreign key constraint violated on the constraint: `review_sessions_attachmentId_fkey`'), { code: 'P2003' });

async function staffApp(t, db) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => { request.user = withSession({ id: 'admin-1', role: 'ADMIN', organizationId: 'org-a' }); });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(attachmentRoutes);
  t.after(() => app.close());
  return (id = DOC.id) => app.inject({ method: 'DELETE', url: `/attachments/${id}` });
}

async function portalApp(t, db) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(jwt, { secret: 'attachment-review-jwt', cookie: { cookieName: 'token', signed: false } });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(clientPortalRoutes);
  t.after(() => app.close());
  const token = app.jwt.sign({ ...PORTAL_USER, contactId: 'contact-a' }, { expiresIn: '1h' });
  return () => app.inject({ method: 'DELETE', url: `/documents/${DOC.id}`, headers: { authorization: `Bearer ${token}` } });
}

for (const [name, build] of [['staff attachment route', staffApp], ['client portal document route', portalApp]]) {
  test(`${name} refuses to delete a file under review`, async (t) => {
    const db = fakeDb({ reviews: 1 });
    const response = await (await build(t, db))();
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'ATTACHMENT_UNDER_REVIEW');
    assert.deepEqual(db.deleted, []);
  });

  test(`${name} answers 409 when a review starts before the delete (foreign key)`, async (t) => {
    const db = fakeDb({ deleteError: FK_ERROR });
    const response = await (await build(t, db))();
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(response.json().code, 'ATTACHMENT_UNDER_REVIEW');
  });

  test(`${name} still deletes a file that is not under review`, async (t) => {
    const db = fakeDb();
    const response = await (await build(t, db))();
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(db.deleted, [DOC.id]);
  });
}
