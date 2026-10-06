// An approved client reply is sent as approved: the Gmail draft carries its
// text unchanged and never asks AI to rewrite it.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

const { createFakeAiDb, installFakeGovernance } = await import('../helpers/fake-ai-db.js');
const { default: gmailRoutes } = await import('../../routes/gmail.routes.js');
const { gmailDraftReplySchema } = await import('../../validators/schemas.js');

const APPROVED_TEXT = 'Hi Olivia,\n\nThe dieline is coming Friday the 12th.\n\nBest,\nSam';

async function gmailApp(responses) {
  const app = Fastify();
  const lookups = [];
  const prisma = {
    organization: { findUnique: async () => ({ name: 'Northwind Studio' }) },
    thread: {
      findUnique: async () => ({
        id: 'thr-1',
        subject: 'Launch date',
        client: { name: 'Northwind' },
        messages: [{ direction: 'INBOUND', senderEmail: 'olivia@northwind.test', bodyText: 'Friday?', aiExtracted: null }],
      }),
    },
    response: {
      findFirst: async ({ where }) => {
        lookups.push(where);
        return responses.find((r) => r.id === where.id && r.threadId === where.threadId) || null;
      },
    },
  };
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'u1', name: 'Pat Lee', email: 'pat@studio.test', organizationId: 'org-a', role: 'TEAM' };
  });
  app.decorate('adminOnly', async () => {});
  app.addHook('preHandler', async (request) => { request.prisma = prisma; });
  await app.register(gmailRoutes);
  return { app, lookups };
}

function aiMustNotRun() {
  return {
    isConfigured: () => true,
    chat: async () => { throw new Error('AI must not rewrite an approved reply'); },
  };
}

test('draft-reply accepts an optional saved draft id', () => {
  assert.equal(gmailDraftReplySchema.safeParse({ hubThreadId: 'thr-1', responseId: 'r1' }).success, true);
  assert.equal(gmailDraftReplySchema.safeParse({ hubThreadId: 'thr-1' }).success, true);
});

test('an approved saved draft is used word for word, without AI', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: aiMustNotRun }));
  const { app, lookups } = await gmailApp([
    { id: 'r1', threadId: 'thr-1', status: 'APPROVED', subject: 'Re: Launch date', body: APPROVED_TEXT },
  ]);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/draft-reply', payload: { hubThreadId: 'thr-1', responseId: 'r1' } });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json();
  assert.equal(body.draft, APPROVED_TEXT);
  assert.equal(body.subject, 'Re: Launch date');
  assert.equal(body.responseId, 'r1');
  assert.equal(body.notice, null);
  assert.equal(body.to, 'olivia@northwind.test');
  // The saved draft must belong to this conversation.
  assert.deepEqual(lookups, [{ id: 'r1', threadId: 'thr-1' }]);
});

test('a saved draft that is not approved yet is refused', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: aiMustNotRun }));
  const { app } = await gmailApp([
    { id: 'r2', threadId: 'thr-1', status: 'PENDING_APPROVAL', subject: 'Re: Launch date', body: 'Not yet' },
  ]);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/draft-reply', payload: { hubThreadId: 'thr-1', responseId: 'r2' } });
  assert.equal(response.statusCode, 409, response.body);
  assert.equal(response.json().code, 'RESPONSE_NOT_APPROVED');
});

test('a saved draft from another conversation is not found', async (t) => {
  t.after(await installFakeGovernance(createFakeAiDb(), { platformProvider: aiMustNotRun }));
  const { app } = await gmailApp([
    { id: 'r3', threadId: 'thr-other', status: 'APPROVED', subject: 'Re: Other', body: 'Other text' },
  ]);
  t.after(() => app.close());

  const response = await app.inject({ method: 'POST', url: '/draft-reply', payload: { hubThreadId: 'thr-1', responseId: 'r3' } });
  assert.equal(response.statusCode, 404, response.body);
});
