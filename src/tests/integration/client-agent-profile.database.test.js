import { assertDisposableDatabase } from '../helpers/disposable-database.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { readClientAgentProfile, saveClientAgentProfile } from '../../services/client-agent-profile.service.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const url = process.env.TENANT_INTEGRATION_DATABASE_URL;
const input = { revision: 0, name: 'Account manager QA', instructions: 'Use sourced facts.', enabled: true, pluginIds: ['client-work'] };
// Fault injection stays inside the same real interactive database transaction.
function withoutAudit(client) {
  return new Proxy(client, { get(target, key) {
    if (key === 'auditEvent') return { create: async () => { throw new Error('Synthetic audit failure'); } };
    if (key === '$transaction') return (fn, ...args) => target.$transaction(tx => fn(withoutAudit(tx)), ...args);
    const value = target[key];
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
test('client profiles persist, isolate tenants, resolve concurrent writes and roll back without audit', {
  skip: !url && 'Disposable PostgreSQL is not configured', timeout: 120_000,
}, async () => {
  assertDisposableDatabase({ ...process.env, DATABASE_URL: url });
  const raw = new prismaPkg.PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const orgs = ['a', 'b'].map(key => `agent-profile-${key}-${randomUUID()}`);
  try {
    for (const id of orgs) await raw.organization.create({ data: { id, slug: id, name: 'Agent profile QA' } });
    const people = [];
    const clients = [];
    for (const organizationId of orgs) {
      people.push(await raw.user.create({ data: { organizationId, role: 'ADMIN', name: 'Profile QA', email: `${randomUUID()}@e2e.example.test`, password: randomUUID() } }));
      clients.push(await raw.client.create({ data: { organizationId, name: 'Profile QA client' } }));
    }
    assert.equal((await readClientAgentProfile(raw, people[0], clients[0].id)).revision, 0);
    assert.equal(await raw.clientAgentProfile.count({ where: { organizationId: orgs[0] } }), 0);
    const created = await Promise.allSettled([
      saveClientAgentProfile(raw, people[0], clients[0].id, input),
      saveClientAgentProfile(raw, people[0], clients[0].id, { ...input, name: 'Concurrent profile' }),
    ]);
    assert.equal(created.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(created.find(result => result.status === 'rejected').reason.code, 'PROFILE_CONFLICT');
    assert.equal(await raw.clientAgentProfile.count({ where: { organizationId: orgs[0] } }), 1);
    const saved = await readClientAgentProfile(raw, people[0], clients[0].id);
    const updated = await Promise.allSettled([
      saveClientAgentProfile(raw, people[0], clients[0].id, { ...input, revision: saved.revision, name: 'First edit' }),
      saveClientAgentProfile(raw, people[0], clients[0].id, { ...input, revision: saved.revision, name: 'Second edit' }),
    ]);
    assert.equal(updated.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(updated.find(result => result.status === 'rejected').reason.code, 'PROFILE_CONFLICT');
    assert.equal((await readClientAgentProfile(raw, people[0], clients[0].id)).revision, 2);
    await assert.rejects(readClientAgentProfile(raw, people[1], clients[0].id), { code: 'RECORD_NOT_FOUND' });
    await assert.rejects(saveClientAgentProfile(raw, people[1], clients[0].id, input), { code: 'RECORD_NOT_FOUND' });
    await assert.rejects(raw.clientAgentProfile.create({ data: { organizationId: orgs[0], clientId: clients[1].id,
      name: 'Forbidden tenant edge', createdById: people[0].id, updatedById: people[0].id } }));
    // The migrated CHECK must agree with the API's closed, unique plugin set.
    // This exercises raw database writes, independent of Zod or tenant proxy.
    const profileWhere = { clientId: clients[0].id };
    for (const pluginIds of [[], ['client-work'], ['client-task-actions'], ['client-work','client-task-actions'], ['client-task-actions','client-work']]) {
      const row = await raw.clientAgentProfile.update({ where: profileWhere, data: { pluginIds } });
      assert.deepEqual(row.pluginIds, pluginIds);
    }
    const bad = [['client-work','client-work'], ['client-task-actions','client-task-actions'], ['client-work','client-task-actions','client-work'], ['unknown'], [1], [null], [[]], {}, 'client-work', null];
    for (const value of bad) await assert.rejects(raw.$executeRaw`UPDATE client_agent_profiles SET "pluginIds" = ${JSON.stringify(value)}::jsonb WHERE "clientId" = ${clients[0].id}`);
    for (const data of [{name:''}, {name:'x'.repeat(101)}, {instructions:'x'.repeat(2001)}, {revision:0}, {portalEnabled:true}]) await assert.rejects(raw.clientAgentProfile.update({where:profileWhere,data}));
    assert.deepEqual((await raw.clientAgentProfile.findUnique({where:profileWhere})).pluginIds, ['client-task-actions','client-work']);
    await raw.clientAgentProfile.update({where:profileWhere,data:{pluginIds:['client-work']}});
    const defaultRow = await raw.clientAgentProfile.create({data:{organizationId:orgs[1],clientId:clients[1].id,name:'Old worker default',createdById:people[1].id,updatedById:people[1].id}});
    assert.deepEqual(defaultRow.pluginIds,['client-work']); assert.equal(defaultRow.portalEnabled,false);
    await raw.clientAgentProfile.delete({where:{id:defaultRow.id}});
    const before = await readClientAgentProfile(raw, people[0], clients[0].id);
    await assert.rejects(saveClientAgentProfile(withoutAudit(raw), people[0], clients[0].id,
      { ...input, revision: before.revision, name: 'Must roll back' }), { code: 'PROFILE_AUDIT_UNAVAILABLE' });
    assert.deepEqual(await readClientAgentProfile(raw, people[0], clients[0].id), before);
    await assert.rejects(saveClientAgentProfile(withoutAudit(raw), people[1], clients[1].id, input), { code: 'PROFILE_AUDIT_UNAVAILABLE' });
    assert.equal(await raw.clientAgentProfile.count({ where: { organizationId: orgs[1] } }), 0);
    await raw.user.update({ where: { id: people[0].id }, data: { isActive: false } });
    await assert.rejects(saveClientAgentProfile(raw, people[0], clients[0].id, { ...input, revision: 2 }), { code: 'ROLE_DENIED' });
  } finally {
    await raw.clientAgentProfile.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    if (await purgeFixtureAuditEvents(raw, { ids: orgs })) await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});
