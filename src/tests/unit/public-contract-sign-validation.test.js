// POST /api/contracts/sign/:signToken is public. Its body is validated by
// contractSignSchema before any lookup: a non-string signerName used to reach
// the signature hash and answer 500, and signatureImage had no size limit.
import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

process.env.CONTRACT_SIGNATURE_SECRET ||= 'contract-sign-validation-secret';

const { default: contractRoutes } = await import('../../routes/contract.routes.js');
const { contractSignSchema } = await import('../../validators/schemas.js');
const { outboxStore } = await import('../helpers/domain-event-fake.js');

const FUTURE = new Date(Date.now() + 86_400_000);

async function buildApp(t) {
  const calls = { lookups: 0, updates: [] };
  const contract = { id: 'k-1', clientId: 'client-1', status: 'SENT', content: 'terms', publicAccessExpiresAt: FUTURE, publicAccessRevokedAt: null };
  /** @type {any} */
  const prisma = {
    contract: {
      findUnique: async () => { calls.lookups += 1; return contract; },
      updateMany: async ({ data }) => { calls.updates.push(data); return { count: 1 }; },
    },
    client: { findUnique: async () => ({ organizationId: 'org-1' }) },
    auditEvent: { create: async ({ data }) => ({ id: 'audit-1', ...data }) },
  };
  const outbox = outboxStore();
  prisma.domainEvent = outbox.domainEvent;
  prisma.$executeRaw = outbox.$executeRaw;
  prisma.$transaction = async (fn) => fn(prisma);
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', prisma);
  app.addHook('onRequest', async (request) => { request.prisma = prisma; });
  await app.register(contractRoutes);
  t.after(() => app.close());
  return { app, calls };
}

const sign = (app, payload) => app.inject({ method: 'POST', url: '/sign/sign-token', payload });

test('the public contract sign route declares contractSignSchema', async (t) => {
  const preHandlers = [];
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async () => {});
  app.decorate('prisma', {});
  app.addHook('onRoute', (options) => {
    if (options.method === 'POST' && options.url === '/sign/:signToken') preHandlers.push(...[options.preHandler].flat());
  });
  await app.register(contractRoutes);
  await app.ready();
  t.after(() => app.close());
  // validateBody tags its guard with the schema it enforces.
  assert.ok(preHandlers.some((guard) => guard?.zodSchema === contractSignSchema), 'validateBody(contractSignSchema) guards the route');
});

test('a non-string signerName is a 400, never a 500, and nothing is looked up', async (t) => {
  const { app, calls } = await buildApp(t);
  for (const signerName of [123, { first: 'Jane' }, ['Jane'], '   ', null]) {
    const response = await sign(app, { signerName, agreement: true });
    assert.equal(response.statusCode, 400, `${JSON.stringify(signerName)}: ${response.body}`);
  }
  assert.equal(calls.lookups, 0);
});

test('agreement must be literally true and signatureType must be known', async (t) => {
  const { app, calls } = await buildApp(t);
  assert.equal((await sign(app, { signerName: 'Jane', agreement: 'yes' })).statusCode, 400);
  assert.equal((await sign(app, { signerName: 'Jane' })).statusCode, 400);
  assert.equal((await sign(app, { signerName: 'Jane', agreement: true, signatureType: 'stamp' })).statusCode, 400);
  assert.equal(calls.lookups, 0);
});

test('a drawn signature needs an image, and the image size is bounded', async (t) => {
  const { app, calls } = await buildApp(t);
  assert.equal((await sign(app, { signerName: 'Jane', agreement: true, signatureType: 'draw' })).statusCode, 400);
  const oversized = await sign(app, { signerName: 'Jane', agreement: true, signatureType: 'draw', signatureImage: 'a'.repeat(50_001) });
  assert.equal(oversized.statusCode, 400);
  assert.equal((await sign(app, { signerName: 'Jane', agreement: true, signatureImage: 42 })).statusCode, 400);
  assert.equal(calls.lookups, 0);
});

test('a valid typed signature still signs, with type as the default', async (t) => {
  const { app, calls } = await buildApp(t);
  const response = await sign(app, { signerName: '  Jane Signer ', agreement: true });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().signatureType, 'type');
  assert.equal(calls.updates[0].clientSigName, 'Jane Signer', 'the name is trimmed');

  // A fresh contract (each signing records its own outbox event).
  const { app: drawApp } = await buildApp(t);
  const drawn = await sign(drawApp, { signerName: 'Jane', agreement: true, signatureType: 'draw', signatureImage: 'data:image/png;base64,AAAA' });
  assert.equal(drawn.statusCode, 200, drawn.body);
  assert.equal(drawn.json().signatureType, 'draw');
});
