import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import invoiceBillingRoutes from '../../routes/invoice-billing.routes.js';
import { createWorkspaceTools } from '../../integrations/workspace-tools.js';
import { WORKSPACE_BILLING_TOOLS } from '../../integrations/workspace-billing-tools.js';

test('billing execution resolves minimal requester identities to a fresh active administrator before any mutation', async () => {
  const identity = { id: 'admin', organizationId: 'org' };
  let current = null;
  const prisma = { user: { findFirst: async ({ where }) => {
    assert.equal(where.role, 'ADMIN'); assert.equal(where.isActive, true); assert.equal(where.id, identity.id); assert.equal(where.organizationId, identity.organizationId);
    return current;
  } }, client: { findFirst: async () => null } };
  const tool = WORKSPACE_BILLING_TOOLS.find(tool => tool.name === 'create_unbilled_invoice_draft');
  const input = { selection: { clientId: 'client', title: 'Reviewed', currency: 'CAD', taxType: 'NONE', taxRate: 0, times: [{ id: 'time', updatedAt: '2026-10-14T00:00:00Z', hourlyRate: 0 }] }, fingerprint: 'a'.repeat(64) };
  await assert.rejects(tool.execution.execute({ prisma, user: identity, input }), { code: 'ROLE_DENIED' });
  current = { ...identity, role: 'ADMIN' };
  await assert.rejects(tool.execution.execute({ prisma, user: identity, input }), { code: 'RECORD_NOT_FOUND' });
});

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
