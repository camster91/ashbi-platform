import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';

describe('client portal cookie session flow', () => {
  let app;
  let sessionVersion = 2;
  const activityRows = [];
  let revisionStatus = 'IN_REVIEW';
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true,
  };
  const contact = { id: 'contact-a', email: user.email, name: user.name, clientId: 'client-a' };
  const client = { id: 'client-a', organizationId: 'org-a', name: 'Example Client' };

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'portal-session-test-secret', cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: {
        findUnique: async ({ where }) => (where.id === user.id ? { ...user, sessionVersion } : null),
        update: async () => ({ ...user, sessionVersion: ++sessionVersion }),
      },
      contact: {
        findFirst: async ({ where }) => (where.id === contact.id && where.clientId === client.id ? contact : null),
        findUnique: async ({ where }) => (where.id === contact.id ? contact : null),
      },
      client: {
        findFirst: async ({ where }) => (where.id === client.id ? client : null),
        findUnique: async ({ where }) => (where.id === client.id ? client : null),
      },
      project: {
        findFirst: async ({ where }) => (where.id === 'project-a' && where.clientId === client.id ? { id: 'project-a', name: 'Portal Project' } : null),
      },
      revisionRound: {
        findFirst: async ({ where }) => (where.id === 'revision-a' && where.projectId === 'project-a' && where.project?.clientId === client.id
          ? { id: 'revision-a', roundNumber: 1, status: revisionStatus }
          : null),
        updateMany: async () => {
          if (revisionStatus === 'APPROVED') return { count: 0 };
          revisionStatus = 'APPROVED';
          return { count: 1 };
        },
        findUnique: async () => ({ id: 'revision-a', roundNumber: 1, status: revisionStatus }),
      },
      activity: {
        create: async ({ data }) => {
          const row = { id: `activity-${activityRows.length + 1}`, createdAt: new Date(), ...data };
          activityRows.push(row);
          return row;
        },
      },
      attachment: {
        findUnique: async ({ where }) => {
          const base = {
            entityType: 'PROJECT',
            entityId: 'project-a',
            mimeType: 'text/plain',
            originalName: 'project-note.txt',
          };
          if (where.id === 'missing-document') {
            return { id: where.id, path: '.missing-portal-document', ...base };
          }
          if (where.id === 'unreadable-document') {
            return { id: where.id, path: '.', ...base };
          }
          return null;
        },
      },
      contract: {
        findMany: async () => [{
          id: 'contract-a', title: 'Project agreement', status: 'SENT', signToken: 'sign-a',
          templateType: 'PROJECT', publicAccessExpiresAt: null, publicAccessRevokedAt: null,
          signedAt: null, clientSigName: null, createdAt: new Date(), updatedAt: new Date(),
        }],
      },
    };
    prisma.$transaction = async callback => callback(prisma);
    app.decorate('prisma', prisma);
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    app.addHook('preHandler', async request => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });

  after(async () => app.close());

  it('registers the public API at the frontend path without a duplicated prefix', async () => {
    const correct = await app.inject({ method: 'POST', url: '/api/client-portal/verify-token', payload: { token: 'invalid' } });
    const doubled = await app.inject({ method: 'POST', url: '/api/client-portal/client-portal/verify-token', payload: { token: 'invalid' } });
    assert.equal(correct.statusCode, 401);
    assert.equal(doubled.statusCode, 404);
  });

  it('returns 404 only when a client document is absent from storage', async () => {
    const bearer = app.jwt.sign({ ...user, contactId: contact.id, sessionVersion }, { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/client-portal/documents/missing-document/download',
      headers: { authorization: `Bearer ${bearer}` },
    });

    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, 'Document not found');
  });

  it('returns 500 instead of masking a document storage failure as absent', async () => {
    const bearer = app.jwt.sign({ ...user, contactId: contact.id, sessionVersion }, { expiresIn: '1h' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/client-portal/documents/unreadable-document/download',
      headers: { authorization: `Bearer ${bearer}` },
    });

    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error, 'Failed to download document');
  });

  it('exchanges a bounded magic token for an httpOnly session and revokes it on logout', async () => {
    const magicToken = app.jwt.sign({
      ...user,
      contactId: contact.id,
      sessionVersion,
    }, { expiresIn: '1h' });
    const verified = await app.inject({
      method: 'POST',
      url: '/api/client-portal/verify-token',
      payload: { token: magicToken },
    });
    assert.equal(verified.statusCode, 200);
    assert.equal(Object.hasOwn(verified.json(), 'token'), false);
    const setCookie = verified.headers['set-cookie'];
    assert.match(setCookie, /HttpOnly/i);
    const sessionCookie = setCookie.split(';', 1)[0];

    const me = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { cookie: sessionCookie } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().client.name, client.name);

    const logout = await app.inject({ method: 'POST', url: '/api/client-portal/logout', headers: { cookie: sessionCookie } });
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers['set-cookie'], /Max-Age=0|Expires=/i);

    const revoked = await app.inject({ method: 'GET', url: '/api/client-portal/me', headers: { cookie: sessionCookie } });
    assert.equal(revoked.statusCode, 401);
  });

  it('scopes contracts and records client revision approval and feedback as durable activities', async () => {
    const bearer = app.jwt.sign({ ...user, contactId: contact.id, sessionVersion }, { expiresIn: '1h' });
    const headers = { authorization: `Bearer ${bearer}` };
    const contracts = await app.inject({ method: 'GET', url: '/api/client-portal/contracts', headers });
    assert.equal(contracts.statusCode, 200);
    assert.equal(contracts.json()[0].canReview, true);

    const approval = await app.inject({
      method: 'POST',
      url: '/api/client-portal/projects/project-a/revisions/revision-a/respond',
      headers,
      payload: { action: 'APPROVE' },
    });
    assert.equal(approval.statusCode, 200);
    assert.equal(approval.json().status, 'APPROVED');
    assert.equal(activityRows.at(-1).type, 'CLIENT_REVISION_APPROVED');

    const feedback = await app.inject({
      method: 'POST',
      url: '/api/client-portal/projects/project-a/feedback',
      headers,
      payload: { message: 'Please update the launch copy.' },
    });
    assert.equal(feedback.statusCode, 201);
    assert.equal(activityRows.at(-1).type, 'CLIENT_FEEDBACK');
    assert.match(activityRows.at(-1).metadata, /launch copy/);

    const crossClient = await app.inject({
      method: 'POST',
      url: '/api/client-portal/projects/project-b/feedback',
      headers,
      payload: { message: 'Must not cross tenant boundaries.' },
    });
    assert.equal(crossClient.statusCode, 404);
  });
});
