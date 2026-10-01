// The router decodes percent-escapes, but tenancy, the session hook and the
// rate limiter read request.url. Before URL canonicalisation, /%61pi/clients
// routed to /api/clients while those checks saw a non-API path, so any
// signed-in user (including a client-portal session) read and changed every
// organisation's data. Every spelling that reaches an API handler must be
// scoped exactly like the canonical one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

const SPELLINGS = [
  '/api/clients',
  '/%61pi/clients',
  '/%61%70%69/clients',
  '/api/%63lients',
  '/%2561pi/clients',
  '//api/clients',
  '/api//clients',
  '/./api/clients',
  '/API/clients',
];

// app.inject normalises the target (dot segments, absolute-form) before the
// app sees it, so the spellings that bypassed the first fix only reproduce on
// a real socket with the request line exactly as sent.
function rawRequest(port, method, target, { cookie = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('error', reject);
    socket.on('end', () => {
      const status = Number((data.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]);
      resolve({ status, body: data.slice(data.indexOf('\r\n\r\n') + 4) });
    });
    const payload = body ? JSON.stringify(body) : '';
    socket.write([
      `${method} ${target} HTTP/1.1`,
      'Host: 127.0.0.1',
      'Connection: close',
      ...(cookie ? [`Cookie: ${cookie}`] : []),
      ...(payload ? ['Content-Type: application/json', `Content-Length: ${Buffer.byteLength(payload)}`] : []),
      '',
      payload,
    ].join('\r\n'));
  });
}

function cookieOf(response) {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [header];
  return cookies.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
}

test('encoded and non-canonical API paths are tenant-scoped like /api', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  process.env.DATABASE_URL = databaseUrl;
  const { buildApp } = await import('../../index.js');
  const { rawPrisma } = await import('../../config/db.js');
  const { hashPassword } = await import('../../auth/password.js');

  const suffix = randomUUID().slice(0, 8);
  const orgA = `enc-org-a-${suffix}`;
  const orgB = `enc-org-b-${suffix}`;
  const password = 'Str0ng!Passphrase';
  const app = await buildApp({ initializeRuntime: false, jwtSecret: 'encoded-path-tenancy-secret-0123456789' });
  await app.ready();

  try {
    await rawPrisma.organization.create({ data: { id: orgA, name: 'Org A', slug: `enc-a-${suffix}` } });
    await rawPrisma.organization.create({ data: { id: orgB, name: 'Org B', slug: `enc-b-${suffix}` } });
    const clientA = await rawPrisma.client.create({ data: { name: `Secret A ${suffix}`, organizationId: orgA, status: 'ACTIVE' } });
    const clientB = await rawPrisma.client.create({ data: { name: `Own B ${suffix}`, organizationId: orgB, status: 'ACTIVE' } });
    const adminBEmail = `admin-b-${suffix}@example.test`;
    await rawPrisma.user.create({ data: {
      email: adminBEmail, password: await hashPassword(password), name: 'Admin B', role: 'ADMIN', organizationId: orgB, isActive: true,
    } });
    const portalEmail = `portal-${suffix}@example.test`;
    await rawPrisma.user.create({ data: {
      email: portalEmail, password: await hashPassword(password), name: 'Portal', role: 'CLIENT', clientId: clientB.id, organizationId: orgB, isActive: true,
    } });

    const staffLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: adminBEmail, password } });
    assert.equal(staffLogin.statusCode, 200, staffLogin.body);
    const staff = cookieOf(staffLogin);
    const portalLogin = await app.inject({ method: 'POST', url: '/api/auth/client/login', payload: { email: portalEmail, password } });
    assert.equal(portalLogin.statusCode, 200, portalLogin.body);
    const portal = cookieOf(portalLogin);

    for (const url of SPELLINGS) {
      const list = await app.inject({ method: 'GET', url, headers: { cookie: staff } });
      if (list.statusCode === 200) {
        const names = JSON.stringify(list.json());
        assert.ok(!names.includes(clientA.name), `${url} leaked another organisation's client`);
        assert.ok(names.includes(clientB.name), `${url} answered 200 without the caller's own client`);
      } else {
        assert.equal(list.statusCode, 404, `${url}: ${list.statusCode} ${list.body}`);
      }

      const asClient = await app.inject({ method: 'GET', url, headers: { cookie: portal } });
      assert.ok([403, 404].includes(asClient.statusCode), `${url} as a client-portal session: ${asClient.statusCode} ${asClient.body}`);
    }

    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address();
    for (const target of [
      '/%61pi/clients',
      '/%6%31pi/clients',
      '/%%36%31pi/clients',
      'http://x/api/clients',
      'https://x/api/clients',
      'http://user@x/api/clients',
      'http://x/%61pi/clients',
    ]) {
      for (const [label, cookie] of [['staff', staff], ['client-portal', portal]]) {
        const response = await rawRequest(port, 'GET', target, { cookie });
        assert.ok(!response.body.includes(clientA.name), `${label} ${target} leaked another organisation's client (${response.status})`);
        if (label === 'client-portal') {
          assert.ok([400, 403, 404].includes(response.status), `client-portal ${target}: ${response.status} ${response.body}`);
        }
      }
    }
    for (const target of [`http://x/api/clients/${clientA.id}`, `/%6%31pi/clients/${clientA.id}`]) {
      for (const cookie of [staff, portal]) {
        const response = await rawRequest(port, 'PUT', target, { cookie, body: { name: 'Hijacked' } });
        assert.ok([400, 403, 404].includes(response.status), `PUT ${target}: ${response.status} ${response.body}`);
      }
    }

    const rename = await app.inject({
      method: 'PUT', url: `/%61pi/clients/${clientA.id}`, headers: { cookie: staff }, payload: { name: 'Hijacked' },
    });
    assert.ok([403, 404].includes(rename.statusCode), `cross-tenant rename: ${rename.statusCode} ${rename.body}`);
    const after = await rawPrisma.client.findUnique({ where: { id: clientA.id } });
    assert.equal(after.name, clientA.name);
  } finally {
    await app.close();
    await rawPrisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await rawPrisma.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await purgeFixtureAuditEvents(rawPrisma, { ids: [orgA, orgB] });
    await rawPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  }
});
