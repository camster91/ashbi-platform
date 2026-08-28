import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify from 'fastify';
import portalRoutes from '../../routes/portal.routes.js';

describe('public proposal approval currency boundary', () => {
  let app;
  let updateCalls;
  const proposal = {
    id: 'proposal-legacy',
    viewToken: 'legacy-token',
    status: 'VIEWED',
    currency: null,
    validUntil: new Date('2099-09-30T12:00:00.000Z'),
    publicAccessExpiresAt: new Date('2099-09-30T12:00:00.000Z'),
    publicAccessRevokedAt: null,
  };

  before(async () => {
    app = Fastify({ logger: false });
    updateCalls = 0;
    const prisma = {
      proposal: {
        findUnique: async ({ where }) => (where.viewToken === proposal.viewToken ? proposal : null),
        update: async () => {
          updateCalls += 1;
          return proposal;
        },
      },
    };
    app.addHook('preHandler', async request => { request.prisma = prisma; });
    await app.register(portalRoutes, { prefix: '/api/portal' });
    await app.ready();
  });

  after(async () => app.close());

  it('rejects a direct approval request when legacy currency evidence is unresolved', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/portal/proposal/${proposal.viewToken}/approve`,
    });

    assert.equal(response.statusCode, 409);
    assert.deepEqual(response.json(), {
      error: 'Proposal currency must be reviewed before approval',
    });
    assert.equal(updateCalls, 0);
  });
});
