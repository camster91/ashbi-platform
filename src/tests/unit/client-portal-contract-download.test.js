import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';

describe('client portal signed contract download', () => {
  let app;
  const sessionVersion = 1;
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true,
  };
  const contact = { id: 'contact-a', email: user.email, name: user.name, clientId: 'client-a' };
  const client = { id: 'client-a', organizationId: 'org-a', name: 'Example Client' };
  const signedAt = new Date('2026-09-01T12:00:00.000Z');
  const contracts = [
    { id: 'contract-a', clientId: 'client-a', status: 'SIGNED', title: 'Signed Agreement', content: '<p>Scope of work</p>', templateType: 'PROJECT', clientSigName: 'Client User', signedAt, clientSigHash: 'abc123', createdAt: signedAt, deletedAt: null },
    { id: 'contract-other', clientId: 'client-b', status: 'SIGNED', title: 'Other Client Agreement', content: 'secret', templateType: 'PROJECT', clientSigName: 'Other', signedAt, createdAt: signedAt, deletedAt: null },
    { id: 'contract-unsigned', clientId: 'client-a', status: 'SENT', title: 'Pending Agreement', content: 'draft', templateType: 'PROJECT', createdAt: signedAt, deletedAt: null },
    { id: 'contract-deleted', clientId: 'client-a', status: 'SIGNED', title: 'Deleted', content: 'x', templateType: 'PROJECT', createdAt: signedAt, deletedAt: new Date() },
  ];
  const queries = [];

  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => (row[key] ?? null) === value);
  }

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'portal-contract-test-secret', cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: { findUnique: async ({ where }) => (where.id === user.id ? { ...user, sessionVersion } : null) },
      contact: { findFirst: async ({ where }) => (where.id === contact.id && where.clientId === client.id ? contact : null) },
      client: { findFirst: async ({ where }) => (where.id === client.id ? client : null) },
      contract: {
        findFirst: async ({ where }) => {
          queries.push(where);
          const row = contracts.find(candidate => matches(candidate, where));
          return row ? { ...row, client: { name: row.clientId === 'client-a' ? 'Example Client' : 'Other Client' } } : null;
        },
        findMany: async ({ where }) => contracts
          .filter(row => row.clientId === where.clientId && row.deletedAt === null && where.status.in.includes(row.status))
          .map(({ content, clientId, deletedAt, ...row }) => ({ ...row, signToken: `sign-${row.id}`, publicAccessExpiresAt: null, publicAccessRevokedAt: null, updatedAt: signedAt })),
      },
    };
    app.decorate('prisma', prisma);
    app.addHook('preHandler', async request => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });

  after(async () => app.close());

  const auth = () => ({ authorization: `Bearer ${app.jwt.sign({ ...user, contactId: contact.id, sessionVersion }, { expiresIn: '1h' })}` });

  it('streams a PDF of the client\'s own signed contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/client-portal/contracts/contract-a/pdf', headers: auth() });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/pdf');
    assert.match(response.headers['content-disposition'], /attachment; filename="Signed_Agreement\.pdf"/);
    assert.equal(response.headers['cache-control'], 'private, no-store');
    assert.equal(response.rawPayload.subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual(queries.at(-1), { id: 'contract-a', clientId: 'client-a', deletedAt: null, status: 'SIGNED' });
  });

  it('returns 404 for another client\'s signed contract', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/client-portal/contracts/contract-other/pdf', headers: auth() });
    assert.equal(response.statusCode, 404);
    assert.equal(response.headers['content-type'].startsWith('application/pdf'), false);
  });

  it('returns 404 for unsigned or deleted contracts', async () => {
    for (const id of ['contract-unsigned', 'contract-deleted', 'missing']) {
      const response = await app.inject({ method: 'GET', url: `/api/client-portal/contracts/${id}/pdf`, headers: auth() });
      assert.equal(response.statusCode, 404, id);
    }
  });

  it('requires a portal session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/client-portal/contracts/contract-a/pdf' });
    assert.equal(response.statusCode, 401);
  });

  it('marks only signed contracts as downloadable in the list', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/client-portal/contracts', headers: auth() });
    assert.equal(response.statusCode, 200);
    const byId = Object.fromEntries(response.json().map(row => [row.id, row]));
    assert.equal(byId['contract-a'].canDownload, true);
    assert.equal(byId['contract-unsigned'].canDownload, false);
    assert.equal(byId['contract-other'], undefined);
  });
});
