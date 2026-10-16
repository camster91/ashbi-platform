import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { readClientAgentProfile, saveClientAgentProfile } from '../../services/client-agent-profile.service.js';
import profileRoutes from '../../routes/client-agent-profile.routes.js';

const user = { id: 'staff-a', organizationId: 'org-a', role: 'ADMIN', isActive: true };
const client = { id: 'client-a', organizationId: 'org-a', deletedAt: null };
const input = { revision: 0, name: '  Alex  ', instructions: '  Explain missing facts.  ', enabled: true, pluginIds: ['client-work'] };
function matches(row, where = {}) {
  return row && Object.entries(where).every(([key, value]) => key === 'AND' ? value.every(item => matches(row, item))
    : key === 'OR' ? value.some(item => matches(row, item)) : row[key] === value || (value === null && row[key] == null));
}
function fixture(options = {}) {
  const state = { actor: { ...user, ...options.actor }, client: { ...client, ...options.client }, profile: null, audits: [] };
  const calls = [];
  const db = {
    user: { findFirst: async ({ where }) => { calls.push('user'); return matches(state.actor, where) ? state.actor : null; } },
    client: { findFirst: async ({ where }) => { calls.push('client'); return matches(state.client, where) ? state.client : null; } },
    clientAgentProfile: {
      findFirst: async ({ where }) => { calls.push('profile'); return matches(state.profile, where) ? structuredClone(state.profile) : null; },
      findMany: async ({ where }) => matches(state.profile, where) ? [structuredClone(state.profile)] : [],
      create: async ({ data }) => {
        calls.push('create');
        if (state.profile || options.createCollision) throw Object.assign(new Error('secret unique key'), { code: 'P2002' });
        state.profile = { id: 'profile-a', updatedAt: new Date(), ...data };
        return structuredClone(state.profile);
      },
      updateMany: async ({ where, data }) => {
        calls.push('update');
        if (!matches(state.profile, where) || options.updateCollision) return { count: 0 };
        state.profile = { ...state.profile, ...data, revision: state.profile.revision + 1 };
        return { count: 1 };
      },
    },
    auditEvent: { create: async ({ data }) => {
      if (options.auditFailure) throw new Error('secret audit connection');
      state.audits.push(data); return { id: 'audit-a', ...data };
    } },
    $transaction: async fn => {
      const before = structuredClone(state);
      try { return await fn(db); } catch (error) { Object.assign(state, before); throw error; }
    },
  };
  return { db, state, calls };
}
test('default read is side-effect free and does not invent persisted identity', async () => {
  const { db, calls, state } = fixture();
  assert.deepEqual(await readClientAgentProfile(db, user, client.id), { id: null, clientId: client.id,
    name: 'Account manager', instructions: '', enabled: true, portalEnabled: false, revision: 0, pluginIds: ['client-work'] });
  assert.deepEqual(calls, ['user', 'client', 'profile']); assert.equal(state.audits.length, 0);
});
test('saved profile reloads, records actor and safe audit metadata; updates require observed revision', async () => {
  const { db, state } = fixture();
  const saved = await saveClientAgentProfile(db, user, client.id, input);
  assert.equal(saved.name, 'Alex'); assert.equal(saved.instructions, 'Explain missing facts.');
  assert.equal(saved.revision, 1); assert.equal(saved.portalEnabled, false);
  assert.equal(state.profile.createdById, user.id); assert.equal(state.profile.updatedById, user.id);
  assert.deepEqual(await readClientAgentProfile(db, user, client.id), saved);
  const updated = await saveClientAgentProfile(db, user, client.id, { ...input, revision: 1, enabled: false, pluginIds: [] });
  assert.equal(updated.revision, 2); assert.equal(updated.enabled, false); assert.deepEqual(updated.pluginIds, []);
  assert.equal(state.audits.length, 2); assert.equal(state.audits[0].action, 'client_agent_profile.created');
  assert.equal(state.audits[1].action, 'client_agent_profile.updated');
  assert.doesNotMatch(JSON.stringify(state.audits), /Explain missing facts|instructions/);
  await assert.rejects(saveClientAgentProfile(db, user, client.id, { ...input, revision: 1 }), { code: 'PROFILE_CONFLICT', statusCode: 409 });
  assert.equal(state.profile.revision, 2);
});
for (const options of [{ createCollision: true }, { updateCollision: true }]) {
  test(`unique-create or concurrent-update collision is a safe 409 ${JSON.stringify(options)}`, async () => {
    const { db, state } = fixture(options);
    const revision = options.updateCollision ? 1 : 0;
    if (revision) state.profile = { id: 'profile-a', organizationId: user.organizationId, clientId: client.id, ...input, revision };
    await assert.rejects(saveClientAgentProfile(db, user, client.id, { ...input, revision }), { code: 'PROFILE_CONFLICT', statusCode: 409 });
    assert.equal(state.audits.length, 0);
  });
}
test('audit failure rolls back creation and update', async () => {
  for (const existing of [false, true]) {
    const { db, state } = fixture({ auditFailure: true });
    if (existing) state.profile = { id: 'profile-a', organizationId: user.organizationId, clientId: client.id, ...input, revision: 1 };
    const before = structuredClone(state.profile);
    await assert.rejects(saveClientAgentProfile(db, user, client.id, { ...input, revision: existing ? 1 : 0 }), { code: 'PROFILE_AUDIT_UNAVAILABLE' });
    assert.deepEqual(state.profile, before);
  }
});
for (const role of ['BOT', 'CLIENT', 'STAFF', undefined]) {
  test(`unprivileged ${role} cannot read or mutate`, async () => {
    const { db, calls } = fixture();
    await assert.rejects(readClientAgentProfile(db, { ...user, role }, client.id), { code: 'ROLE_DENIED' });
    await assert.rejects(saveClientAgentProfile(db, { ...user, role }, client.id, input), { code: 'ROLE_DENIED' });
    assert.deepEqual(calls, []);
  });
}
for (const actor of [{ role: 'CLIENT' }, { role: 'BOT' }, { isActive: false }, { organizationId: 'org-b' }, { id: 'another-staff' }]) {
  test(`stored staff authority rechecked ${JSON.stringify(actor)}`, async () => {
    const { db, calls } = fixture({ actor });
    await assert.rejects(readClientAgentProfile(db, user, client.id), { code: 'ROLE_DENIED' });
    await assert.rejects(saveClientAgentProfile(db, user, client.id, input), { code: 'ROLE_DENIED' });
    assert.ok(calls.every(call => call === 'user'));
  });
}
for (const override of [{ organizationId: 'org-b' }, { id: 'client-b' }, { deletedAt: new Date() }]) {
  test(`foreign, missing and deleted client fail uniformly ${JSON.stringify(override)}`, async () => {
    const { db, calls } = fixture({ client: override });
    await assert.rejects(readClientAgentProfile(db, user, client.id), { code: 'RECORD_NOT_FOUND', statusCode: 404 });
    await assert.rejects(saveClientAgentProfile(db, user, client.id, input), { code: 'RECORD_NOT_FOUND', statusCode: 404 });
    assert.ok(!calls.includes('profile') && !calls.includes('create'));
  });
}
test('strict bounded input rejects scope, plugin, portal and revision injection before any query', async () => {
  for (const patch of [{ portalEnabled: true }, { organizationId: 'org-b' }, { clientId: 'client-b' },
    { revision: -1 }, { revision: 1.5 }, { revision: 2147483647 }, { name: ' ' }, { name: 'a'.repeat(101) },
    { instructions: 'a'.repeat(2001) }, { enabled: 'true' }, { pluginIds: ['email'] }, { pluginIds: ['client-work', 'client-work'] }]) {
    const { db, calls } = fixture();
    await assert.rejects(saveClientAgentProfile(db, user, client.id, { ...input, ...patch }), { code: 'INVALID_INPUT' });
    assert.deepEqual(calls, []);
  }
});
test('stored TEAM remains authorized with organization-shared configuration', async () => {
  const { db } = fixture({ actor: { role: 'TEAM' } });
  assert.equal((await saveClientAgentProfile(db, user, client.id, input)).revision, 1);
});
test('HTTP routes redact unexpected database failures and reject invalid bodies before reads', async () => {
  const { db, calls } = fixture();
  const app = Fastify();
  app.decorate('authenticate', async request => { request.user = user; request.prisma = db; });
  await app.register(profileRoutes, { prefix: '/api/client-assistants' });
  try {
    const invalid = await app.inject({ method: 'PATCH', url: `/api/client-assistants/${client.id}/profile`, payload: { ...input, portalEnabled: true } });
    assert.equal(invalid.statusCode, 400); assert.deepEqual(calls, []);
    const initial = await app.inject({ method: 'GET', url: `/api/client-assistants/${client.id}/profile` });
    assert.equal(initial.statusCode, 200); assert.equal(initial.json().revision, 0);
    db.clientAgentProfile.findFirst = async () => { throw new Error('database password private'); };
    const failed = await app.inject({ method: 'GET', url: `/api/client-assistants/${client.id}/profile` });
    assert.equal(failed.statusCode, 503); assert.doesNotMatch(failed.body, /password|private/);
  } finally { await app.close(); }
});


test('closed task plugin selection remains explicitly opt-in, with unique bounded string IDs', async () => {
  const valid = [[], ['client-work'], ['client-task-actions'], ['client-work', 'client-task-actions'], ['client-task-actions', 'client-work']];
  for (const pluginIds of valid) {
    const { db } = fixture();
    assert.deepEqual((await saveClientAgentProfile(db, user, client.id, { ...input, pluginIds })).pluginIds, pluginIds);
  }
  for (const pluginIds of [['client-work', 'client-work'], ['client-task-actions', 'client-task-actions'], ['client-work','client-task-actions','other'], ['other'], [1], [null], [[]], {}, null]) {
    const { db, state } = fixture();
    await assert.rejects(saveClientAgentProfile(db, user, client.id, { ...input, pluginIds }), { code: 'INVALID_INPUT' });
    assert.equal(state.profile, null);
  }
  const { db } = fixture(); assert.deepEqual((await readClientAgentProfile(db, user, client.id)).pluginIds, ['client-work']);
});
