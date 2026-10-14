import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import invoiceBillingRoutes from '../../routes/invoice-billing.routes.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';

test('workspace billing receipts and preparation replays recheck administrator status before returning private history', async () => {
  const tools = createWorkspaceTools();
  const ctx = { user: { id: 'admin', organizationId: 'org', role: 'ADMIN' }, scopes: ['workspace:read', 'workspace:actions'],
    prisma: { user: { findFirst: async () => null }, aiBridgeAction: { findFirst: async () => ({ action: 'create_unbilled_invoice_draft', source: 'ai_bridge' }) } },
  };
  await assert.rejects(tools.call(ctx, 'get_action', { actionId: 'receipt' }), { code: 'ROLE_DENIED' });
  await assert.rejects(tools.call(ctx, 'create_unbilled_invoice_draft', {}), { code: 'ROLE_DENIED' });
  await assert.rejects(tools.call({ ...ctx, user: { ...ctx.user, role: 'TEAM' } }, 'get_action', { actionId: 'receipt' }), { code: 'ROLE_DENIED' });
});

test('session billing adapter verifies current admin and confines receipt operations to owned billing actions', async () => {
  const app = Fastify();
  let role = 'ADMIN', action = 'create_unbilled_invoice_draft';
  const calls = [];
  const user = { id: 'admin', role: 'ADMIN', organizationId: 'org' };
  app.decorate('adminOnly', async request => {
    request.user = user;
    request.prisma = { user: { findFirst: async () => role === 'ADMIN' ? user : null },
      aiBridgeAction: { findFirst: async ({ where }) => {
        assert.equal(where.organizationId, 'org'); assert.equal(where.userId, 'admin');
        return where.id === 'owned' ? { action, source: 'ai_bridge' } : null;
      } },
    };
  });
  await app.register(invoiceBillingRoutes, { billingTools: { call: async (ctx, name, body) => {
    calls.push({ ctx, name, body }); return { kind: 'pending' };
  } } });
  const post = (name, payload) => app.inject({ method: 'POST', url: `/unbilled/tools/${name}`, payload });
  try {
    assert.equal((await post('create_task', {})).statusCode, 404);
    assert.equal((await post('confirm_action', { actionId: 'foreign' })).statusCode, 404);
    action = 'create_task';
    assert.equal((await post('confirm_action', { actionId: 'owned' })).statusCode, 404);
    action = 'create_unbilled_invoice_draft';
    assert.equal((await post('confirm_action', { actionId: 'owned' })).statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].ctx.scopes, ['workspace:read', 'workspace:actions']);
    role = 'TEAM';
    assert.equal((await post('get_action', { actionId: 'owned' })).statusCode, 403);
    assert.equal((await post('preview_unbilled_invoice', {})).statusCode, 403);
    assert.equal(calls.length, 1);
  } finally { await app.close(); }
});
