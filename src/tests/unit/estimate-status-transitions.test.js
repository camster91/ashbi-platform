// PUT /api/estimates/:id edits drafts but never changes their status: an
// estimate is sent by POST /:id/send, approved or declined only by the client
// through its link, and converted by POST /:id/convert.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';

const { default: estimateRoutes, estimateStatusChangeError } = await import('../../routes/estimate.routes.js');

async function setup(t, status) {
  const rows = new Map([['est_1', {
    id: 'est_1', status, clientId: 'client_1', title: 'Website estimate', lineItems: [], subtotal: 0, tax: 0, total: 0,
  }]]);
  const writes = [];
  const prisma = {
    estimate: {
      findUnique: async ({ where }) => rows.get(where.id) ?? null,
      update: async ({ where, data }) => {
        writes.push(data);
        const row = { ...rows.get(where.id), ...data };
        rows.set(where.id, row);
        return row;
      },
    },
  };
  const app = Fastify();
  app.decorate('authenticate', async (request) => {
    request.user = { id: 'user_1', organizationId: 'org_1', role: 'ADMIN' };
    request.prisma = prisma;
  });
  await app.register(estimateRoutes, { prefix: '/api/estimates' });
  t.after(() => app.close());
  const put = (payload) => app.inject({ method: 'PUT', url: '/api/estimates/est_1', payload });
  return { put, rows, writes };
}

describe('estimate status transitions through PUT', () => {
  for (const status of ['APPROVED', 'DECLINED', 'SENT', 'CONVERTED', 'EXPIRED']) {
    it(`refuses DRAFT -> ${status}`, async (t) => {
      const { put, rows, writes } = await setup(t, 'DRAFT');
      const response = await put({ status });
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, 'ESTIMATE_STATUS_TRANSITION');
      assert.equal(rows.get('est_1').status, 'DRAFT');
      assert.equal(writes.length, 0);
    });
  }

  it('rejects statuses that do not exist', async (t) => {
    const { put } = await setup(t, 'DRAFT');
    assert.equal((await put({ status: 'ACCEPTED' })).statusCode, 400);
  });

  it('still edits a draft, and status DRAFT is a no-op', async (t) => {
    const { put, rows, writes } = await setup(t, 'DRAFT');
    const response = await put({ title: 'Renamed', status: 'DRAFT' });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(rows.get('est_1').title, 'Renamed');
    assert.equal(rows.get('est_1').status, 'DRAFT');
    assert.equal('status' in writes[0], false);
  });

  it('does not edit a sent estimate at all, so a client answer cannot be forged', async (t) => {
    const { put, rows } = await setup(t, 'SENT');
    const response = await put({ status: 'APPROVED' });
    assert.ok([400, 409].includes(response.statusCode), response.body);
    assert.equal(rows.get('est_1').status, 'SENT');
  });

  it('names the route that owns each status change', () => {
    assert.equal(estimateStatusChangeError('DRAFT', undefined), null);
    assert.equal(estimateStatusChangeError('DRAFT', 'DRAFT'), null);
    assert.match(estimateStatusChangeError('DRAFT', 'APPROVED'), /Only the client can approve/);
    assert.match(estimateStatusChangeError('DRAFT', 'SENT'), /\/send/);
    assert.match(estimateStatusChangeError('SENT', 'CONVERTED'), /\/convert/);
  });
});
