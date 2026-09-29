import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { databasePoolConfig } from '../../config/db-pool.js';

test('the pg pool has an explicit, env-configurable size and timeouts', () => {
  assert.deepEqual(databasePoolConfig({ DATABASE_URL: 'postgresql://x' }), {
    connectionString: 'postgresql://x',
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  const tuned = databasePoolConfig({ DATABASE_POOL_MAX: '25', DATABASE_POOL_CONNECT_TIMEOUT_MS: '2000' });
  assert.equal(tuned.max, 25);
  assert.equal(tuned.connectionTimeoutMillis, 2000);
  assert.equal(databasePoolConfig({ DATABASE_POOL_MAX: '0' }).max, 1);
  assert.equal(databasePoolConfig({ DATABASE_POOL_MAX: '5000' }).max, 100);
  assert.equal(databasePoolConfig({ DATABASE_POOL_MAX: 'lots' }).max, 10);
});

test('the Prisma client uses the pool config and the runbook documents role timeouts', () => {
  const db = fs.readFileSync(new URL('../../config/db.js', import.meta.url), 'utf8');
  assert.match(db, /new PrismaPg\(databasePoolConfig\(\)\)/);
  const runbook = fs.readFileSync(new URL('../../../docs/deployment-and-rollback.md', import.meta.url), 'utf8');
  assert.match(runbook, /DATABASE_POOL_MAX/);
  assert.match(runbook, /statement_timeout/);
  assert.match(runbook, /idle_in_transaction_session_timeout/);
});
