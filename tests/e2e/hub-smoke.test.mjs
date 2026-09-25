// tests/e2e/hub-smoke.test.mjs
//
// Full-stack smoke against the real Docker stack from docker-compose.test.yml
// (Postgres + Redis + worker + hub). Run `npm run test:e2e:setup` first.

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { close as closeDb, findClientById, findUserByEmail } from './helpers/db.mjs';

const HUB_BASE = process.env.HUB_BASE || 'http://localhost:3001';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'cameron@ashbi.ca';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TestPass123!';

let sessionCookie = null;
let clientId = null;

async function http(method, path, { body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${HUB_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  return { status: res.status, text, json, headers: res.headers };
}

function tokenCookie(headers) {
  for (const raw of headers.getSetCookie?.() || []) {
    const match = raw.match(/^token=([^;]+)/);
    if (match) return `token=${match[1]}`;
  }
  return null;
}

beforeAll(async () => {
  const health = await http('GET', '/api/health').catch((error) => ({ status: 0, text: String(error) }));
  if (health.status !== 200) {
    throw new Error(`hub not ready at ${HUB_BASE}/api/health (run npm run test:e2e:setup): ${health.status} ${health.text?.slice(0, 300)}`);
  }
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe('full-stack hub smoke', () => {
  test('readiness reports database, redis and a fresh worker heartbeat', async () => {
    const res = await http('GET', '/api/health');
    expect(res.status, res.text).toBe(200);
    expect(res.json.ready).toBe(true);
    for (const check of ['database', 'redis', 'worker']) {
      expect(res.json.checks[check].status, `${check}: ${JSON.stringify(res.json.checks[check])}`).toBe('ok');
    }
  });

  test('protected routes reject anonymous requests', async () => {
    const me = await http('GET', '/api/auth/me');
    expect(me.status).toBe(401);
    const clients = await http('GET', '/api/clients');
    expect(clients.status).toBe(401);
  });

  test('seeded admin logs in and receives a session cookie', async () => {
    const res = await http('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    expect(res.status, res.text).toBe(200);
    sessionCookie = tokenCookie(res.headers);
    expect(sessionCookie, 'login sets the token cookie').toBeTruthy();

    const me = await http('GET', '/api/auth/me', { cookie: sessionCookie });
    expect(me.status, me.text).toBe(200);
    expect(me.json.email).toBe(ADMIN_EMAIL);
    expect(me.json.role).toBe('ADMIN');
  });

  test('wrong password is rejected without a session', async () => {
    const res = await http('POST', '/api/auth/login', { body: { email: ADMIN_EMAIL, password: 'not-the-password' } });
    expect(res.status).toBe(401);
    expect(tokenCookie(res.headers)).toBeNull();
  });

  test('creating a client persists it in the admin organization', async () => {
    expect(sessionCookie, 'login step ran').toBeTruthy();
    const name = `E2E Smoke Client ${Date.now()}`;
    const created = await http('POST', '/api/clients', { cookie: sessionCookie, body: { name, status: 'PROSPECT' } });
    expect(created.status, created.text).toBe(201);
    clientId = created.json.id;
    expect(clientId).toBeTruthy();

    const [row, admin] = await Promise.all([findClientById(clientId), findUserByEmail(ADMIN_EMAIL)]);
    expect(row, 'clients row exists').toBeTruthy();
    expect(row.name).toBe(name);
    expect(row.organizationId).toBe(admin.organizationId);
  });

  test('the new client is readable and listed through the API', async () => {
    expect(clientId, 'create step ran').toBeTruthy();
    const single = await http('GET', `/api/clients/${clientId}`, { cookie: sessionCookie });
    expect(single.status, single.text).toBe(200);
    expect(single.json.id).toBe(clientId);

    const list = await http('GET', `/api/clients?search=${encodeURIComponent('E2E Smoke Client')}`, { cookie: sessionCookie });
    expect(list.status, list.text).toBe(200);
    expect(list.json.clients.map((client) => client.id)).toContain(clientId);
  });

  test('retired WordPress bridge endpoints are gone', async () => {
    const res = await http('GET', '/api/wp-bridge', { cookie: sessionCookie });
    expect(res.status).toBe(404);
  });
});
