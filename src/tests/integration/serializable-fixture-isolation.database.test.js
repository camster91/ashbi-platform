import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
test('shared relations can abort disjoint Serializable fixtures; sequential transactions preserve both writes', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured', timeout: 30_000,
}, async () => {
  // This diagnostic creates only an isolated synthetic schema on the CI test
  // service. It never falls back to DATABASE_URL or connects to a remote host.
  const target = new URL(databaseUrl);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/testdb');
  assert.equal(process.env.NODE_ENV, 'test');
  const schema = `ssi_fixture_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^ssi_fixture_[a-f0-9]{32}$/);
  const table = `"${schema}"."fixture_rows"`;
  const clients = [0, 1, 2].map(() => new pg.Client({ connectionString: databaseUrl }));
  const [admin, a, b] = clients;
  let created = false;
  try {
    await Promise.all(clients.map(client => client.connect()));
    await admin.query(`CREATE SCHEMA "${schema}"`);created = true;
    await admin.query(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, organization TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0)`);
    await admin.query(`INSERT INTO ${table} (id, organization) VALUES ('row-a', 'org-a'), ('row-b', 'org-b')`);
    for (const client of [a, b]) {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      // Force the documented mechanism deterministically; settings end with
      // this transaction. This does not claim the original CI plan was known.
      await client.query('SET LOCAL enable_indexscan = off');
      await client.query('SET LOCAL enable_bitmapscan = off');
      await client.query('SET LOCAL enable_seqscan = on');
    }
    const select = `SELECT value FROM ${table} WHERE id = $1 AND organization = $2`;
    const plan = await a.query(`EXPLAIN (FORMAT JSON) ${select}`, ['row-a', 'org-a']);
    assert.equal(plan.rows[0]['QUERY PLAN'][0].Plan['Node Type'], 'Seq Scan');
    assert.equal((await a.query(select, ['row-a', 'org-a'])).rows[0].value, 0);
    assert.equal((await b.query(select, ['row-b', 'org-b'])).rows[0].value, 0);
    const locks = await admin.query(`SELECT pid FROM pg_locks WHERE mode = 'SIReadLock' AND locktype = 'relation' AND relation = $1::regclass AND pid = ANY($2::integer[])`, [table, [a.processID, b.processID]]);
    assert.equal(new Set(locks.rows.map(row => row.pid)).size, 2);
    await a.query(`UPDATE ${table} SET value = value + 1 WHERE id = 'row-a' AND organization = 'org-a'`);
    await a.query('COMMIT');
    await assert.rejects(b.query(`UPDATE ${table} SET value = value + 1 WHERE id = 'row-b' AND organization = 'org-b'`), { code: '40001' });
    await b.query('ROLLBACK');
    assert.deepEqual((await admin.query(`SELECT id, value FROM ${table} ORDER BY id`)).rows, [{ id: 'row-a', value: 1 }, { id: 'row-b', value: 0 }]);
    // Control: same independent fixture operations with no cross-file overlap.
    for (const [client, id, org] of [[a, 'row-a', 'org-a'], [b, 'row-b', 'org-b']]) {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      await client.query(select, [id, org]);
      await client.query(`UPDATE ${table} SET value = value + 1 WHERE id = $1 AND organization = $2`, [id, org]);
      await client.query('COMMIT');
    }
    assert.deepEqual((await admin.query(`SELECT id, value FROM ${table} ORDER BY id`)).rows, [{ id: 'row-a', value: 2 }, { id: 'row-b', value: 1 }]);
  } finally {
    await Promise.allSettled([a.query('ROLLBACK'), b.query('ROLLBACK')]);
    try { if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`); }
    finally { await Promise.allSettled(clients.map(client => client.end())); }
  }
});
