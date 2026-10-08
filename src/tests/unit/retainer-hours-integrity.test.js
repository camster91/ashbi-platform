import assert from 'node:assert/strict';
import test from 'node:test';
import retainerRoutes from '../../routes/retainer.routes.js';
import { buildInvoiceApp } from '../helpers/fake-invoice-db.js';

async function hoursApp(t, { failEntry = false, failPlan = false, noAdmin = false } = {}) {
  const state = { hoursUsed: 0, entries: [] };
  const db = {
    project: { findFirst: async ({ where }) => where.id === 'project-a' && where.clientId === 'client-a' ? { id: 'project-a' } : null },
    user: { findFirst: async () => noAdmin ? null : { id: 'admin-a' } },
    retainerPlan: { findUnique: async () => ({ clientId: 'client-a', hoursPerMonth: 10, hoursUsed: state.hoursUsed }) },
    $transaction: async (work) => {
      const pending = structuredClone(state);
      const tx = {
        timeEntry: { create: async ({ data }) => {
          if (failEntry) throw new Error('entry failure');
          pending.entries.push(data);
          return data;
        } },
        retainerPlan: { update: async ({ where, data }) => {
          assert.equal(where.clientId, 'client-a');
          if (failPlan) throw new Error('plan failure');
          pending.hoursUsed += data.hoursUsed.increment;
          return { hoursPerMonth: 10, hoursUsed: pending.hoursUsed };
        } },
      };
      const result = await work(tx);
      Object.assign(state, pending);
      return result;
    },
  };
  const app = await buildInvoiceApp(t, retainerRoutes, db, { prefix: '/api/retainers' });
  const log = (payload) => app.inject({ method: 'POST', url: '/api/retainers/client-a/log-hours', payload });
  return { log, state };
}

test('retainer logging refuses another client project without charging hours', async (t) => {
  const { log, state } = await hoursApp(t);
  const response = await log({ hours: 1, projectId: 'project-client-b' });
  assert.equal(response.statusCode, 404, response.body);
  assert.deepEqual(state, { hoursUsed: 0, entries: [] });
});

test('retainer logging commits the matching project entry and hours together', async (t) => {
  const { log, state } = await hoursApp(t);
  const response = await log({ hours: 1.5, projectId: 'project-a' });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(state.hoursUsed, 1.5);
  assert.equal(state.entries[0].duration, 90);
  assert.equal(state.entries[0].projectId, 'project-a');
});

for (const failure of ['failEntry', 'failPlan']) {
  test(`retainer logging rolls back both records on ${failure}`, async (t) => {
    const { log, state } = await hoursApp(t, { [failure]: true });
    const response = await log({ hours: 1, projectId: 'project-a' });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(state, { hoursUsed: 0, entries: [] });
  });
}

test('retainer logging without a project still increments the plan', async (t) => {
  const { log, state } = await hoursApp(t);
  const response = await log({ hours: 1 });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(state, { hoursUsed: 1, entries: [] });
});

test('retainer logging refuses to charge a project entry when no administrator can record it', async (t) => {
  const { log, state } = await hoursApp(t, { noAdmin: true });
  const response = await log({ hours: 1, projectId: 'project-a' });
  assert.equal(response.statusCode, 409, response.body);
  assert.deepEqual(state, { hoursUsed: 0, entries: [] });
});
