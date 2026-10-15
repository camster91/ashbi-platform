import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual processor registrations without starting Redis workers,
// heartbeat timers, process handlers or the rest of the application runtime.
function processors(overrides = {}) {
  const source = readFileSync(new URL('../../jobs/worker.js', import.meta.url), 'utf8');
  const start = source.indexOf('const scheduledWorker = createWorker(');
  const end = source.indexOf('const clientAgentWorker = createWorker(', start);
  assert.ok(start >= 0 && end > start);
  const registered = new Map();
  const dependencies = {
    QUEUES: { SCHEDULED: 'scheduled-maintenance', DOMAIN_EVENTS: 'domain-events' },
    backgroundPrisma: { source: 'background' },
    createWorker: (name, process, options) => { registered.set(name, { process, options }); return {}; },
    resolveTenantOrganizationIds: async () => ['org-a', 'org-b'],
    runTenantJob: async (_db, org, callback) => callback({ organizationId: org }),
    expireClientAgentRuns: async () => ({ expired: 1, queueExpired: 2 }),
    dispatchDomainEvents: async () => ({ dispatched: true }),
    logger: { error() {} },
    ...overrides,
  };
  runInNewContext(source.slice(start, end), dependencies);
  return registered;
}
test('stalled tenant expiry cannot block dispatch on the separate outbox processor', async () => {
  let release;
  let started;
  const didStart = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let dispatches = 0;
  const registered = processors({
    resolveTenantOrganizationIds: async () => ['org-a'],
    expireClientAgentRuns: async () => { started(); await blocked; return { expired: 1, queueExpired: 0 }; },
    dispatchDomainEvents: async () => { dispatches += 1; return 'outbox-completed'; },
  });
  const scheduled = registered.get('scheduled-maintenance');
  const domain = registered.get('domain-events');
  const sweep = scheduled.process({ name: 'expire-client-agent-runs' });
  await didStart;
  try {
    const dispatched = await domain.process({ name: 'dispatch-domain-events' });
    assert.equal(dispatched, 'outbox-completed'); assert.equal(dispatches, 1);
    assert.equal(scheduled.options.concurrency, 1);
    assert.equal(domain.options.concurrency, 1);
  } finally { release(); await sweep; }
});
test('outbox dispatch never enumerates tenants, even when tenant discovery fails', async () => {
  const registered = processors({ resolveTenantOrganizationIds: async () => { throw new Error('Tenant enumeration unavailable'); } });
  assert.equal((await registered.get('domain-events').process({ name: 'dispatch-domain-events' })).dispatched, true);
  await assert.rejects(registered.get('domain-events').process({ name: 'unknown' }), /Unknown domain events job/);
});
test('maintenance preserves tenant scoping and isolates one organization failure', async () => {
  const visited = [];
  const logs = [];
  const registered = processors({
    runTenantJob: async (db, org, callback) => { assert.equal(db.source, 'background'); visited.push(org); return callback({ organizationId: org }); },
    expireClientAgentRuns: async (tenant, org) => {
      assert.equal(tenant.organizationId, org);
      if (org === 'org-a') throw Object.assign(new Error('private tenant error'), { code: 'DB_UNAVAILABLE' });
      return { expired: 2, queueExpired: 3 };
    },
    logger: { error: (...args) => logs.push(args) },
  });
  const result = await registered.get('scheduled-maintenance').process({ name: 'expire-client-agent-runs' });
  assert.deepEqual(visited, ['org-a', 'org-b']);
  assert.deepEqual({ ...result }, { organizations: 2, expired: 2, queueExpired: 3, failed: 1 });
  assert.equal(logs[0][0].organizationId, 'org-a'); assert.equal(logs[0][0].errorCode, 'DB_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(logs), /private tenant error/);
});
