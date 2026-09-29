// M3 (security audit at 8687cf9): a client-portal user could permanently
// destroy any file on their project (agency deliverables included): the route
// checked the project only and unlinked the stored file.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';

const PORTAL_USER = { id: 'portal-user', email: 'c@x.test', name: 'C', role: 'CLIENT', clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1 };

async function storedFile() {
  const filename = `sec-m3-${randomUUID()}.txt`;
  const relative = `/uploads/${filename}`;
  await fs.mkdir(path.join(process.cwd(), 'uploads'), { recursive: true });
  await fs.writeFile(path.join(process.cwd(), relative), 'deliverable');
  return { filename, relative, absolute: path.join(process.cwd(), relative) };
}

async function buildApp(t, doc) {
  const deleted = [];
  const audits = [];
  const db = {
    auditEvent: { create: async ({ data }) => { audits.push(data); return data; } },
    attachment: {
      findUnique: async ({ where }) => (where.id === doc.id ? { ...doc } : null),
      delete: async ({ where }) => { deleted.push(where.id); return {}; },
    },
    reviewSession: { count: async () => 0 },
    project: { findFirst: async ({ where }) => (where.id === 'proj-1' && where.clientId === 'client-a' ? { id: 'proj-1' } : null) },
    user: { findUnique: async () => PORTAL_USER },
    contact: { findFirst: async () => ({ id: 'contact-a', email: PORTAL_USER.email, clientId: 'client-a' }) },
    client: { findFirst: async () => ({ id: 'client-a', organizationId: 'org-a' }) },
  };
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(jwt, { secret: 'portal-document-delete-secret', cookie: { cookieName: 'token', signed: false } });
  app.addHook('onRequest', async (request) => { request.prisma = db; });
  await app.register(clientPortalRoutes);
  t.after(() => app.close());
  const token = app.jwt.sign({ ...PORTAL_USER, contactId: 'contact-a', typ: 'client_session' }, { expiresIn: '1h' });
  const remove = () => app.inject({ method: 'DELETE', url: `/documents/${doc.id}`, headers: { authorization: `Bearer ${token}` } });
  return { remove, deleted, audits };
}

test('a client cannot delete a file the agency (or anyone else) uploaded', async (t) => {
  const file = await storedFile();
  t.after(() => fs.rm(file.absolute, { force: true }));
  const { remove, deleted } = await buildApp(t, {
    id: 'doc-agency', entityType: 'PROJECT', entityId: 'proj-1', path: file.relative, filename: file.filename,
    mimeType: 'text/plain', size: 11, uploadedById: 'staff-user',
  });
  const response = await remove();
  assert.equal(response.statusCode, 403, response.body);
  assert.equal(response.json().code, 'NOT_UPLOADER');
  assert.deepEqual(deleted, []);
  await fs.access(file.absolute);
});

test('a client deleting their own upload removes it from the portal but keeps the stored file', async (t) => {
  const file = await storedFile();
  t.after(() => fs.rm(file.absolute, { force: true }));
  const { remove, deleted, audits } = await buildApp(t, {
    id: 'doc-own', entityType: 'PROJECT', entityId: 'proj-1', path: file.relative, filename: file.filename,
    mimeType: 'text/plain', size: 11, uploadedById: PORTAL_USER.id,
  });
  const response = await remove();
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(deleted, ['doc-own']);
  await fs.access(file.absolute); // never unlinked
  assert.equal(audits[0].action, 'client_portal.document_deleted');
  assert.equal(audits[0].metadata.fileRetained, true);
  assert.equal(audits[0].metadata.storedFilename, file.filename);
});
