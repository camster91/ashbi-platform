// Client domains and portal identities against a real PostgreSQL schema:
//
// - Client.domain is unique per organization (migration
//   20261001120000_client_domain_per_org): two organizations may use the same
//   domain, any number of clients may have none ('' is stored as NULL), and a
//   duplicate inside one organization is a 409. The migration's normalize and
//   dedupe statements are also run on a temporary copy of "clients".
// - Portal chat messages and uploads are authored by the verified portal
//   principal's user, never by a user looked up (or created) by the
//   contact's email, so a contact stored in mixed case works.
// - Request-access matches a contact stored in mixed case, and answers
//   exactly as for an unknown address.
//
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable,
// fully migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createScopedPrisma } from '../../utils/prisma-tenant-proxy.js';
import clientRoutes from '../../routes/client.routes.js';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { signUserSession } from '../../auth/session.js';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';
import { insensitiveEquals } from '../../utils/insensitive-equals.js';

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('portal-identity-png')]);
const password = () => `fixture-${randomUUID()}`;

async function multipartBody(name, type, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

const skip = !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured';

test('client domains are unique per organization, and blank domains never conflict', { skip, timeout: 60_000 }, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const orgs = [`domain-org-a-${suffix}`, `domain-org-b-${suffix}`];
  const shared = `shared-${suffix}.example`;
  let app;
  try {
    await raw.organization.createMany({ data: orgs.map((id, i) => ({ id, name: `Domain org ${i}`, slug: `domain-${i}-${suffix}` })) });
    let actingOrg = orgs[0];
    app = Fastify({ logger: false });
    await app.register(jwt, { secret: `domain-${randomUUID()}` });
    app.decorate('authenticate', async (request) => {
      request.user = { id: `staff-${actingOrg}`, role: 'ADMIN', organizationId: actingOrg };
    });
    app.addHook('onRequest', async (request) => { request.prisma = createScopedPrisma(raw, actingOrg); });
    await app.register(clientRoutes, { prefix: '/api/clients' });
    await app.ready();
    const create = (payload) => app.inject({ method: 'POST', url: '/api/clients', payload });

    // Org A takes the domain (stored trimmed and lowercased).
    const a = await create({ name: 'A Co', domain: `  ${shared.toUpperCase()} ` });
    assert.equal(a.statusCode, 201, a.body);
    assert.equal(a.json().domain, shared);

    // Two clients without a domain: '' is stored as NULL, so no conflict.
    for (const domain of ['', '  ']) {
      const blank = await create({ name: `Blank ${JSON.stringify(domain)}`, domain });
      assert.equal(blank.statusCode, 201, blank.body);
      assert.equal(blank.json().domain, null);
    }

    // The same domain again in org A (any case) is a conflict.
    const dup = await create({ name: 'A Dup', domain: shared.toUpperCase() });
    assert.equal(dup.statusCode, 409, dup.body);
    const other = await create({ name: 'A Other', domain: `other-${suffix}.example` });
    assert.equal(other.statusCode, 201, other.body);
    const moved = await app.inject({ method: 'PUT', url: `/api/clients/${other.json().id}`, payload: { domain: shared } });
    assert.equal(moved.statusCode, 409, moved.body);
    const unchanged = await app.inject({ method: 'PUT', url: `/api/clients/${a.json().id}`, payload: { domain: shared } });
    assert.equal(unchanged.statusCode, 200, 'a client may keep its own domain');

    // Org B may use the same domain; nothing about org A is revealed.
    actingOrg = orgs[1];
    const b = await create({ name: 'B Co', domain: shared });
    assert.equal(b.statusCode, 201, b.body);
    assert.equal(b.json().domain, shared);

    // The database enforces the same rule for writers that skip the route.
    await assert.rejects(
      raw.client.create({ data: { organizationId: orgs[1], name: 'B Dup', domain: shared } }),
      (err) => err.code === 'P2002',
    );
    assert.equal(await raw.client.count({ where: { domain: shared } }), 2);
  } finally {
    await app?.close();
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await purgeFixtureAuditEvents(raw, { ids: orgs });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
  }
});

test('insensitiveEquals is an exact, case-insensitive match on PostgreSQL', { skip, timeout: 60_000 }, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const org = `ilike-org-${suffix}`;
  const stored = [`John.${suffix}@Acme.Example`, `j_hn.${suffix}@acme.example`, `100%.${suffix}@acme.example`, `back\\slash.${suffix}@acme.example`];
  try {
    await raw.organization.create({ data: { id: org, name: 'ILIKE', slug: `ilike-${suffix}` } });
    await raw.user.createMany({ data: stored.map((email, i) => ({ id: `ilike-${i}-${suffix}`, organizationId: org, email, name: 'U', password: password(), role: 'TEAM' })) });
    const find = async (email) => (await raw.user.findMany({ where: { organizationId: org, email: insensitiveEquals(email) }, select: { email: true } })).map((row) => row.email);
    // Without escaping, Prisma's ILIKE lets `_` and `%` match other addresses.
    assert.equal((await raw.user.findMany({ where: { organizationId: org, email: { equals: `j_hn.${suffix}@acme.example`, mode: 'insensitive' } } })).length, 2);
    assert.deepEqual(await find(`JOHN.${suffix}@acme.example`), [stored[0]]);
    assert.deepEqual(await find(`j_hn.${suffix}@acme.example`), [stored[1]]);
    assert.deepEqual(await find(`%.${suffix}@acme.example`), []);
    assert.deepEqual(await find(`100%.${suffix}@ACME.example`), [stored[2]]);
    assert.deepEqual(await find(`back\\slash.${suffix}@acme.example`), [stored[3]]);
  } finally {
    await raw.user.deleteMany({ where: { organizationId: org } });
    await raw.organization.deleteMany({ where: { id: org } });
    await raw.$disconnect();
  }
});

function migrationStatements(table) {
  const sql = readFileSync(new URL('../../../prisma/migrations/20261001120000_client_domain_per_org/migration.sql', import.meta.url), 'utf8');
  const statement = (marker) => {
    const start = sql.indexOf(marker);
    assert.ok(start >= 0, marker);
    return sql.slice(start, sql.indexOf(';', start)).replaceAll('"clients"', table);
  };
  return [statement('UPDATE "clients"\nSET "domain" = NULLIF'), statement('WITH ranked AS')];
}

test('the migration normalizes domains and keeps the oldest live client per organization', { skip, timeout: 60_000 }, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const rows = await raw.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "clients_copy" (LIKE "clients" INCLUDING DEFAULTS) ON COMMIT DROP');
      const insert = (id, org, domain, createdAt, { deleted = false, notes = null } = {}) => tx.$executeRawUnsafe(
        `INSERT INTO "clients_copy" ("id", "organizationId", "name", "domain", "createdAt", "updatedAt", "deletedAt", "clientNotes")
         VALUES ($1, $2, $1, $3, $4, now(), $5, $6)`,
        id, org, domain, new Date(createdAt), deleted ? new Date() : null, notes,
      );
      await insert('a1', 'org-a', 'Acme.com ', '2025-01-02');
      await insert('a2', 'org-a', 'acme.com', '2025-01-03', { notes: 'kept note' });
      await insert('a0', 'org-a', 'ACME.COM', '2025-01-01', { deleted: true }); // oldest, but soft-deleted
      await insert('a3', 'org-a', '', '2025-01-04');
      await insert('a4', 'org-a', '   ', '2025-01-05');
      await insert('b1', 'org-b', 'acme.com', '2025-01-06'); // another organization keeps its own
      for (const statement of migrationStatements('"clients_copy"')) await tx.$executeRawUnsafe(statement);
      return tx.$queryRawUnsafe('SELECT "id", "domain", "clientNotes" FROM "clients_copy" ORDER BY "id"');
    });
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    assert.equal(byId.a1.domain, 'acme.com', 'the oldest live client keeps the domain');
    assert.equal(byId.a1.clientNotes, null);
    assert.equal(byId.a0.domain, null);
    assert.equal(byId.a2.domain, null);
    assert.match(byId.a2.clientNotes, /^kept note\n\[migration 20261001120000_client_domain_per_org\] Domain "acme\.com" was cleared/);
    assert.equal(byId.a3.domain, null);
    assert.equal(byId.a4.domain, null);
    assert.equal(byId.a3.clientNotes, null, 'blank domains are not duplicates');
    assert.equal(byId.b1.domain, 'acme.com');
  } finally {
    await raw.$disconnect();
  }
});

test('portal chat, uploads and request-access work for a contact stored in mixed case', { skip, timeout: 90_000 }, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID().slice(0, 12);
  const ids = {
    org: `portal-id-org-${suffix}`, client: `portal-id-client-${suffix}`, project: `portal-id-project-${suffix}`,
    portal: `portal-id-user-${suffix}`, contact: `portal-id-contact-${suffix}`, newContact: `portal-id-contact2-${suffix}`,
  };
  // Contacts stored as typed (before emails were normalized on write);
  // portal users are stored lowercased.
  const typed = `Jane.${suffix}@Acme.Example`;
  const typedNew = `Nora.${suffix}@Acme.Example`;
  const saved = { key: process.env.MAILGUN_API_KEY, domain: process.env.MAILGUN_DOMAIN, fetch: globalThis.fetch };
  let app;
  try {
    await raw.organization.create({ data: { id: ids.org, name: 'Portal identity', slug: `portal-id-${suffix}` } });
    await raw.client.create({ data: { id: ids.client, organizationId: ids.org, name: 'Portal identity client' } });
    await raw.project.create({ data: { id: ids.project, organizationId: ids.org, clientId: ids.client, name: 'Site' } });
    await raw.contact.createMany({ data: [
      { id: ids.contact, clientId: ids.client, name: 'Jane', email: typed },
      { id: ids.newContact, clientId: ids.client, name: 'Nora', email: typedNew },
    ] });
    const portalUser = await raw.user.create({ data: {
      id: ids.portal, organizationId: ids.org, clientId: ids.client, email: typed.toLowerCase(), name: 'Jane', password: password(), role: 'CLIENT',
    } });

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
    await app.register(jwt, { secret: `portal-id-${randomUUID()}`, cookie: { cookieName: 'token', signed: false } });
    app.decorate('notify', async () => {});
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    app.addHook('onRequest', async (request) => { request.prisma = raw; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();

    const headers = { authorization: `Bearer ${signUserSession(app.jwt, portalUser, { contactId: ids.contact })}` };
    // Scoped to this fixture: other test files create users concurrently.
    const ownUsers = { OR: [{ organizationId: ids.org }, { clientId: ids.client }] };
    const usersBefore = await raw.user.count({ where: ownUsers });

    // Chat message: authored by the session's user.
    const sent = await app.inject({ method: 'POST', url: `/api/client-portal/projects/${ids.project}/messages`, headers, payload: { content: 'Hello' } });
    assert.equal(sent.statusCode, 201, sent.body);
    const message = await raw.chatMessage.findFirst({ where: { projectId: ids.project } });
    assert.equal(message.authorId, ids.portal);

    // Chat upload and document upload: uploaded by the session's user.
    let body = await multipartBody('a.png', 'image/png', PNG);
    const pending = await app.inject({ method: 'POST', url: `/api/client-portal/projects/${ids.project}/chat-uploads`, headers: { ...headers, 'content-type': body.contentType }, payload: body.payload });
    assert.equal(pending.statusCode, 201, pending.body);
    body = await multipartBody('b.png', 'image/png', PNG);
    const doc = await app.inject({ method: 'POST', url: `/api/client-portal/projects/${ids.project}/upload`, headers: { ...headers, 'content-type': body.contentType }, payload: body.payload });
    assert.equal(doc.statusCode, 201, doc.body);
    const uploaders = await raw.attachment.findMany({ where: { organizationId: ids.org }, select: { uploadedById: true } });
    assert.deepEqual(uploaders.map((row) => row.uploadedById), [ids.portal, ids.portal]);
    const removed = await app.inject({ method: 'DELETE', url: `/api/client-portal/projects/${ids.project}/chat-uploads/${pending.json().id}`, headers });
    assert.equal(removed.statusCode, 200, removed.body);
    assert.equal(await raw.user.count({ where: ownUsers }), usersBefore, 'no user is created for a portal write');

    // Request access: a mixed-case contact gets its link; the answer is the
    // same as for an unknown address.
    process.env.MAILGUN_API_KEY = 'test-key';
    process.env.MAILGUN_DOMAIN = 'mg.example.test';
    const mailed = [];
    globalThis.fetch = async (url, init) => {
      if (String(url).startsWith('https://api.mailgun.net/')) {
        mailed.push(new URLSearchParams(init.body).get('to'));
        return new Response('{}', { status: 200 });
      }
      return saved.fetch(url, init);
    };
    const unknown = await app.inject({ method: 'POST', url: '/api/client-portal/request-access', payload: { email: `nobody-${suffix}@example.test` } });
    // LIKE metacharacters match only themselves: `_` (valid in an address)
    // does not reach Jane's or Nora's address, so no mail is sent and no user
    // is created. (`%` is refused by the email schema; the
    // insensitiveEquals test above covers it at the database.)
    const patterns = [];
    for (const email of [typed.replace('Jane', 'J_ne'), typed.replace('Jane', '____'), typedNew.replace('Nora', 'N_r_')]) {
      patterns.push(await app.inject({ method: 'POST', url: '/api/client-portal/request-access', payload: { email } }));
    }
    assert.deepEqual(mailed, [], 'a LIKE pattern matched a different address');
    assert.equal(await raw.user.count({ where: { organizationId: ids.org } }), 1);
    const existing = await app.inject({ method: 'POST', url: '/api/client-portal/request-access', payload: { email: typed.toUpperCase() } });
    const fresh = await app.inject({ method: 'POST', url: '/api/client-portal/request-access', payload: { email: typedNew.toLowerCase() } });
    for (const response of [unknown, ...patterns, existing, fresh]) {
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), unknown.json());
    }
    assert.deepEqual(mailed, [`Jane <${typed}>`, `Nora <${typedNew}>`]);
    // The existing portal user is reused; a new contact's user is created
    // lowercased, in the contact's organization.
    const users = await raw.user.findMany({ where: { organizationId: ids.org }, orderBy: { email: 'asc' } });
    assert.deepEqual(users.map((user) => [user.email, user.clientId, user.role]), [
      [typed.toLowerCase(), ids.client, 'CLIENT'],
      [typedNew.toLowerCase(), ids.client, 'CLIENT'],
    ]);
  } finally {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.MAILGUN_API_KEY; else process.env.MAILGUN_API_KEY = saved.key;
    if (saved.domain === undefined) delete process.env.MAILGUN_DOMAIN; else process.env.MAILGUN_DOMAIN = saved.domain;
    await app?.close();
    const files = await raw.attachment.findMany({ where: { organizationId: ids.org }, select: { filename: true } });
    await Promise.all(files.map((file) => fs.rm(path.join(UPLOAD_DIR, file.filename), { force: true })));
    await raw.attachment.deleteMany({ where: { organizationId: ids.org } });
    await raw.chatMessage.deleteMany({ where: { projectId: ids.project } });
    await raw.activity.deleteMany({ where: { projectId: ids.project } });
    await raw.project.deleteMany({ where: { id: ids.project } });
    await raw.contact.deleteMany({ where: { clientId: ids.client } });
    await raw.user.deleteMany({ where: { organizationId: ids.org } });
    await raw.client.deleteMany({ where: { id: ids.client } });
    await purgeFixtureAuditEvents(raw, { ids: [ids.org] });
    await raw.organization.deleteMany({ where: { id: ids.org } });
    await raw.$disconnect();
  }
});
