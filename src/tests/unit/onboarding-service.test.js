import assert from 'node:assert/strict';
import test from 'node:test';
import { onboardClient } from '../../services/onboarding.service.js';

function fixture({ failMessage = false } = {}) {
  const writes = [];
  const transaction = {
    client: { create: async ({ data }) => (writes.push(['client', data]), { id: 'client-a', ...data }) },
    contact: { create: async ({ data }) => (writes.push(['contact', data]), { id: 'contact-a', ...data }) },
    retainerPlan: { create: async ({ data }) => (writes.push(['retainer', data]), { id: 'retainer-a', ...data }) },
    project: { create: async ({ data }) => (writes.push(['project', data]), { id: 'project-a', ...data }) },
    thread: { create: async ({ data }) => (writes.push(['thread', data]), { id: 'thread-a', ...data }) },
    message: {
      create: async ({ data }) => {
        if (failMessage) throw new Error('message write failed');
        writes.push(['message', data]);
        return { id: 'message-a', ...data };
      },
    },
    user: { findMany: async () => [{ id: 'admin-a' }] },
    notification: { create: async ({ data }) => (writes.push(['notification', data]), data) },
  };
  const notifications = [];
  const fastify = {
    prisma: {
      $transaction: async callback => {
        writes.push(['transaction-start']);
        const result = await callback(transaction);
        writes.push(['transaction-commit']);
        return result;
      },
    },
    notify: (...args) => notifications.push(args),
  };
  return { fastify, writes, notifications };
}

test('full client onboarding is one transaction and emits only after commit', async () => {
  const { fastify, writes, notifications } = fixture();
  const result = await onboardClient(fastify, {
    name: 'Acme', email: 'owner@acme.example', contactName: 'Owner', retainerTier: '1999', notes: 'Launch',
  });

  assert.equal(result.client.contact.id, 'contact-a');
  assert.equal(result.project.status, 'STARTING_UP');
  assert.equal(writes[0][0], 'transaction-start');
  assert.equal(writes.at(-1)[0], 'transaction-commit');
  const notification = writes.find(([kind]) => kind === 'notification')[1];
  assert.deepEqual(notification.data, { clientId: 'client-a', projectId: 'project-a' });
  assert.deepEqual(notifications, [['admin-a', 'CLIENT_ONBOARDED', { clientId: 'client-a', clientName: 'Acme' }]]);
});

test('full client onboarding never emits success when a transactional write fails', async () => {
  const { fastify, writes, notifications } = fixture({ failMessage: true });
  await assert.rejects(
    onboardClient(fastify, {
      name: 'Acme', email: 'owner@acme.example', contactName: 'Owner', retainerTier: '999', notes: '',
    }),
    /message write failed/,
  );
  assert.equal(writes.some(([kind]) => kind === 'transaction-commit'), false);
  assert.deepEqual(notifications, []);
});
