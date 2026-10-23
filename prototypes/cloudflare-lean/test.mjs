import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { Miniflare } from 'miniflare';

const digest = value => createHash('sha256').update(value).digest('hex');
const scriptPath = new URL('./worker.mjs', import.meta.url).pathname;
const schema = await readFile(new URL('./migrations/0001.sql', import.meta.url), 'utf8');
const config = persist => ({ modules: true, scriptPath, compatibilityDate: '2026-07-30',
  bindings: { LOCAL_PROTOTYPE: 'true' }, d1Databases: { DB: 'lean-prototype' },
  d1Persist: persist, cf: false, host: '127.0.0.1', port: 0 });

test('local Worker and real D1 foundation', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'ashbi-local-d1-'));
  let mf = new Miniflare(config(persist));
  t.after(async () => { await mf.dispose(); await rm(persist, { recursive: true, force: true }); });
  let db = await mf.getD1Database('DB');
  await db.batch(schema.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  for (const [id, org, role, client] of [
    ['staff-a', 'agency-a', 'staff', null], ['staff-b', 'agency-a', 'staff', null],
    ['client-a', 'agency-a', 'client', 'client-a'], ['client-b', 'agency-a', 'client', 'client-b'],
    ['staff-foreign', 'agency-b', 'staff', null],
  ]) await db.prepare('INSERT INTO actors VALUES (?, ?, ?, ?)').bind(id, org, role, client).run();
  for (const [id, org] of [['client-a', 'agency-a'], ['client-b', 'agency-a'], ['foreign', 'agency-b']]) {
    await db.prepare('INSERT INTO clients VALUES (?, ?)').bind(id, org).run();
  }
  const call = (path, { token, method = 'GET', body, origin, headers = {} } = {}) => mf.dispatchFetch(`http://localhost${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(origin ? { Origin: origin } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(actor) {
    const code = randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO login_codes VALUES (?, ?, ?, 0)').bind(digest(code), actor, Date.now() + 60_000).run();
    const response = await call('/api/session', { method: 'POST', body: { code } });
    assert.equal(response.status, 201);
    const { token } = await response.json();
    return { code, token };
  }
  let staff, client, otherClient, foreign, note;
  await t.test('missing local-only opt-in disables the whole API', async () => {
    const disabled = new Miniflare({ ...config(join(persist, 'disabled')), bindings: {} });
    try {
      assert.equal((await disabled.dispatchFetch('http://localhost/api/session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })).status, 404);
    } finally { await disabled.dispose(); }
  });
  await t.test('denies anonymous API and fails closed on nonlocal host', async () => {
    assert.equal((await call('/api/notes')).status, 401);
    const publicResponse = await mf.dispatchFetch('https://unconfigured.example/api/notes');
    assert.equal(publicResponse.status, 404);
    assert.equal((await call('/api/session', { method: 'POST', body: { code: 'invalid' } })).status, 401);
    const expiredCode = randomBytes(32).toString('base64url');
    await db.prepare('INSERT INTO login_codes VALUES (?, ?, ?, 0)').bind(digest(expiredCode), 'staff-a', 0).run();
    assert.equal((await call('/api/session', { method: 'POST', body: { code: expiredCode } })).status, 401);
  });
  await t.test('issues opaque sessions from single-use codes and stores only hashes', async () => {
    const logged = await login('staff-a'); staff = logged.token;
    client = (await login('client-a')).token;
    otherClient = (await login('client-b')).token;
    foreign = (await login('staff-foreign')).token;
    assert.equal((await call('/api/session', { method: 'POST', body: { code: logged.code } })).status, 401);
    const rows = await db.prepare('SELECT token_hash FROM sessions').all();
    assert.equal(rows.results.length, 4);
    assert.ok(rows.results.every(row => row.token_hash !== staff && /^[a-f0-9]{64}$/.test(row.token_hash)));
  });
  await t.test('staff writes persist and caller cannot choose organization or role', async () => {
    const response = await call('/api/notes', { method: 'POST', token: staff,
      body: { clientId: 'client-a', text: 'Synthetic project note', clientVisible: true } });
    assert.equal(response.status, 201); note = await response.json();
    assert.equal((await call('/api/notes', { token: staff })).headers.get('cache-control'), 'no-store');
    assert.equal((await (await call('/api/notes', { token: client })).json()).items.length, 1);
    assert.equal((await call('/api/notes', { method: 'POST', token: staff,
      body: { clientId: 'client-a', text: 'test', clientVisible: true, organizationId: 'agency-b' } })).status, 400);
  });
  await t.test('foreign client, organization and internal notes never leak', async () => {
    for (const token of [otherClient, foreign]) {
      assert.equal((await (await call('/api/notes', { token })).json()).items.length, 0);
      assert.equal((await call(`/api/notes/${note.id}`, { token })).status, 404);
    }
    assert.equal((await call('/api/notes', { method: 'POST', token: client,
      body: { clientId: 'client-a', text: 'not allowed', clientVisible: true } })).status, 403);
    assert.equal((await call('/api/notes', { method: 'POST', token: staff,
      body: { clientId: 'foreign', text: 'not allowed', clientVisible: true } })).status, 404);
    const hidden = await call('/api/notes', { method: 'POST', token: staff,
      body: { clientId: 'client-a', text: 'Internal fixture', clientVisible: false } });
    const { id } = await hidden.json();
    assert.equal((await call(`/api/notes/${id}`, { token: client })).status, 404);
  });
  await t.test('one concurrent revision update wins and stale write conflicts', async () => {
    const secondStaff = (await login('staff-b')).token;
    const responses = await Promise.all([staff, secondStaff].map((token, i) => call(`/api/notes/${note.id}`, {
      method: 'PATCH', token, body: { text: `Concurrent fixture ${i}`, revision: 0 },
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const saved = await (await call(`/api/notes/${note.id}`, { token: client })).json();
    assert.equal(saved.revision, 1);
  });
  await t.test('D1 batch rolls back a preceding write when a constraint fails', async () => {
    await assert.rejects(db.batch([
      db.prepare('INSERT INTO clients VALUES (?, ?)').bind('must-rollback', 'agency-a'),
      db.prepare('INSERT INTO clients VALUES (?, ?)').bind('client-a', 'agency-a'),
    ]));
    assert.equal(await db.prepare('SELECT id FROM clients WHERE id = ?').bind('must-rollback').first(), null);
  });
  await t.test('rejects malformed, oversized and cross-origin mutation inputs', async () => {
    assert.equal((await call('/api/session', { method: 'POST', origin: 'https://elsewhere.example', body: {} })).status, 403);
    assert.equal((await call('/api/notes', { method: 'POST', token: staff, body: { text: 'x'.repeat(9_000) } })).status, 413);
    assert.equal((await call(`/api/notes/${note.id}`, { method: 'PATCH', token: staff, body: { text: 'test', revision: -1 } })).status, 400);
  });
  await t.test('revoked and expired sessions are denied', async () => {
    const revoked = (await login('staff-a')).token;
    assert.equal((await call('/api/session', { method: 'DELETE', token: revoked })).status, 204);
    assert.equal((await call('/api/notes', { token: revoked })).status, 401);
    const expired = (await login('staff-a')).token;
    await db.prepare('UPDATE sessions SET expires_at = 0 WHERE token_hash = ?').bind(digest(expired)).run();
    assert.equal((await call('/api/notes', { token: expired })).status, 401);
  });
  await t.test('database and session survive a local runtime restart', async () => {
    await mf.dispose(); mf = new Miniflare(config(persist)); db = await mf.getD1Database('DB');
    assert.equal((await call(`/api/notes/${note.id}`, { token: client })).status, 200);
  });
  await t.test('bounded workload measures local latency and indexed read rows', async () => {
    // A different client's rows must not turn this indexed read into a full scan.
    for (let batch = 0; batch < 5; batch++) await db.batch(Array.from({ length: 50 }, (_, i) =>
      db.prepare('INSERT INTO notes VALUES (?, ?, ?, ?, 1, 0)')
        .bind(crypto.randomUUID(), 'agency-a', 'client-b', `Synthetic load fixture ${batch * 50 + i}`)));
    const start = performance.now();
    for (let i = 0; i < 100; i++) assert.equal((await call(`/api/notes/${note.id}`, { token: client })).status, 200);
    const sample = await db.prepare('SELECT id FROM notes WHERE organization_id = ? AND client_id = ? AND client_visible = 1 LIMIT 50')
      .bind('agency-a', 'client-a').all();
    console.log(JSON.stringify({ sampleRequests: 100, localMeanWallMs: Number(((performance.now() - start) / 100).toFixed(2)),
      listQueryRowsRead: sample.meta.rows_read, billedCpuMeasured: false }));
    assert.ok(sample.meta.rows_read < 20);
  });
});
