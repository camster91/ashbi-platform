// Real-database proof for expense ownership, receipt checksums and the
// tenant-scoped file routes for receipts and brand logos (migration
// 20261001130000_expense_organization):
// - an expense without a client is created in, and visible to, its own
//   organization only (list, detail and summary);
// - a client or project of another organization is refused;
// - the receipt checksum is computed by the server from the stored file and
//   persisted; free-text or missing receipts are refused, and another
//   organization cannot claim a stored receipt;
// - GET /api/expenses/:id/receipt and GET /api/brand/logo serve the file to
//   their own organization only.
// Runs only when TENANT_INTEGRATION_DATABASE_URL points at a disposable, fully
// migrated database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit-test-secret-at-least-32-characters';

const { createScopedPrisma } = await import('../../utils/prisma-tenant-proxy.js');
const { enterRequestContext, getRequestPrisma } = await import('../../utils/request-context.js');
const { default: expenseRoutes } = await import('../../routes/expense.routes.js');
const { default: brandRoutes } = await import('../../routes/brand.routes.js');

const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`expense-receipt-${randomUUID()}`)]);
const LOGO_1 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('logo-one')]);
const LOGO_2 = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('logo-two')]);
const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

async function multipartBody(name, type, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: form });
  return { payload: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type') };
}

async function buildApp(raw, users, uploadsDir) {
  const app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  // Production resolves fastify.prisma to the request's scoped client.
  app.decorate('prisma', new Proxy({}, {
    get(_target, prop) {
      const client = getRequestPrisma();
      const value = client[prop];
      return typeof value === 'function' ? value.bind(client) : value;
    },
  }));
  app.decorate('authenticate', async (request, reply) => {
    const user = users[request.headers['x-test-user']];
    if (!user) return reply.status(401).send({ error: 'Unauthorized' });
    request.user = { id: user.id, role: user.role, organizationId: user.organizationId };
    return undefined;
  });
  app.decorate('adminOnly', app.authenticate);
  app.addHook('preHandler', async (request) => {
    if (!request.user?.organizationId) return;
    const scoped = createScopedPrisma(raw, request.user.organizationId);
    request.prisma = scoped;
    enterRequestContext({ prisma: scoped, organizationId: request.user.organizationId });
  });
  await app.register(expenseRoutes, { prefix: '/api/expenses', uploadsDir });
  await app.register(brandRoutes, { prefix: '/api/brand', uploadsDir });
  return app;
}

test('expenses belong to their organization; receipts and logos are served only there', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 120_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const orgA = `expense-org-a-${suffix}`;
  const orgB = `expense-org-b-${suffix}`;
  const uploadsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'expense-files-'));
  let app;

  try {
    await raw.organization.createMany({ data: [
      { id: orgA, name: 'Expense Tenant A', slug: `expense-a-${suffix}` },
      { id: orgB, name: 'Expense Tenant B', slug: `expense-b-${suffix}` },
    ] });
    const users = {};
    const fixtures = {};
    for (const [key, org] of [['a', orgA], ['b', orgB]]) {
      users[key] = await raw.user.create({ data: { organizationId: org, email: `expense-${key}-${suffix}@example.com`, name: `Staff ${key}`, password: 'x', role: 'ADMIN' } });
      const client = await raw.client.create({ data: { organizationId: org, name: `Expense client ${key}` } });
      const project = await raw.project.create({ data: { organizationId: org, clientId: client.id, name: `Expense project ${key}` } });
      fixtures[key] = { client, project };
    }
    app = await buildApp(raw, users, uploadsDir);
    const as = (key, method, url, payload) => app.inject({ method, url, payload, headers: { 'x-test-user': key } });
    const date = new Date().toISOString();

    // ── An expense without a client is created in its own organization ──────
    const overhead = await as('a', 'POST', '/api/expenses', { description: `Overhead ${suffix}`, amount: 42.5, date, category: 'SOFTWARE' });
    assert.equal(overhead.statusCode, 200, overhead.body);
    const overheadId = overhead.json().id;
    assert.equal(overhead.json().clientId, null);
    assert.equal((await raw.expense.findUnique({ where: { id: overheadId } })).organizationId, orgA);

    const listA = await as('a', 'GET', '/api/expenses');
    assert.ok(listA.json().expenses.some((expense) => expense.id === overheadId));
    const listB = await as('b', 'GET', '/api/expenses');
    assert.equal(listB.json().expenses.some((expense) => expense.id === overheadId), false);
    assert.equal((await as('a', 'GET', `/api/expenses/${overheadId}`)).statusCode, 200);
    assert.equal((await as('b', 'GET', `/api/expenses/${overheadId}`)).statusCode, 404);
    assert.equal((await as('b', 'PUT', `/api/expenses/${overheadId}`, { description: 'hijack' })).statusCode, 404);
    const summaryA = (await as('a', 'GET', '/api/expenses/summary')).json();
    assert.ok(summaryA.allTimeTotal >= 42.5);
    assert.equal((await as('b', 'GET', '/api/expenses/summary')).json().allTimeCount, 0);

    // Clearing the client keeps the expense in its organization (no orphan).
    const withClient = await as('a', 'POST', '/api/expenses', { description: 'Client work', amount: 10, date, category: 'OTHER', clientId: fixtures.a.client.id, projectId: fixtures.a.project.id });
    assert.equal(withClient.statusCode, 200, withClient.body);
    await createScopedPrisma(raw, orgA).expense.update({ where: { id: withClient.json().id }, data: { clientId: null, projectId: null } });
    assert.equal((await as('a', 'GET', `/api/expenses/${withClient.json().id}`)).statusCode, 200);

    // ── Another organization's client or project is refused ─────────────────
    const crossClient = await as('a', 'POST', '/api/expenses', { description: 'Cross client', amount: 1, date, category: 'OTHER', clientId: fixtures.b.client.id });
    assert.equal(crossClient.statusCode, 404, crossClient.body);
    const crossProject = await as('a', 'POST', '/api/expenses', { description: 'Cross project', amount: 1, date, category: 'OTHER', projectId: fixtures.b.project.id });
    assert.equal(crossProject.statusCode, 404, crossProject.body);
    await assert.rejects(
      createScopedPrisma(raw, orgA).expense.update({ where: { id: overheadId }, data: { clientId: fixtures.b.client.id } }),
      /Tenancy Error/,
    );
    // The database refuses it too, even for an unscoped writer.
    await assert.rejects(
      raw.expense.create({ data: { organizationId: orgA, description: 'raw cross', amount: 1, clientId: fixtures.b.client.id } }),
      /expense client must belong to the expense organization/,
    );
    assert.equal(await raw.expense.count({ where: { organizationId: orgA, description: { in: ['Cross client', 'Cross project', 'raw cross'] } } }), 0);

    // ── Receipts: the server computes and keeps the checksum ────────────────
    const { payload, contentType } = await multipartBody('receipt.png', 'image/png', PNG);
    const upload = await app.inject({ method: 'POST', url: '/api/expenses/upload-receipt', payload, headers: { 'content-type': contentType, 'x-test-user': 'a' } });
    assert.equal(upload.statusCode, 200, upload.body);
    const receiptUrl = upload.json().url;
    assert.match(receiptUrl, /^\/uploads\/receipt-[0-9a-f-]{36}\.png$/);

    const withReceipt = await as('a', 'POST', '/api/expenses', { description: 'With receipt', amount: 12, date, category: 'SUPPLIES', receiptUrl });
    assert.equal(withReceipt.statusCode, 200, withReceipt.body);
    const receiptExpenseId = withReceipt.json().id;
    assert.equal((await raw.expense.findUnique({ where: { id: receiptExpenseId } })).receiptChecksumSha256, sha256(PNG));

    // Attaching it on update also records it; clearing clears the checksum.
    const attachLater = await as('a', 'PUT', `/api/expenses/${overheadId}`, { receiptUrl });
    assert.equal(attachLater.statusCode, 200, attachLater.body);
    assert.equal((await raw.expense.findUnique({ where: { id: overheadId } })).receiptChecksumSha256, sha256(PNG));
    assert.equal((await as('a', 'PUT', `/api/expenses/${overheadId}`, { receiptUrl: '' })).statusCode, 200);
    const cleared = await raw.expense.findUnique({ where: { id: overheadId } });
    assert.deepEqual([cleared.receiptUrl, cleared.receiptChecksumSha256], [null, null]);

    // Only receipts this server stored are accepted.
    for (const bad of ['https://example.com/receipt.png', '/uploads/../package.json', `/uploads/receipt-${randomUUID()}.png`, '/uploads/brand/logo.png']) {
      const refused = await as('a', 'POST', '/api/expenses', { description: 'Bad receipt', amount: 1, date, category: 'OTHER', receiptUrl: bad });
      assert.equal(refused.statusCode, 400, `${bad}: ${refused.body}`);
    }
    // Another organization cannot claim a stored receipt by its URL.
    const claim = await as('b', 'POST', '/api/expenses', { description: 'Claim', amount: 1, date, category: 'OTHER', receiptUrl });
    assert.equal(claim.statusCode, 400, claim.body);
    assert.equal(await raw.expense.count({ where: { organizationId: orgB } }), 0);

    // ── Receipt download is tenant-scoped ───────────────────────────────────
    const receipt = await as('a', 'GET', `/api/expenses/${receiptExpenseId}/receipt`);
    assert.equal(receipt.statusCode, 200, receipt.body);
    assert.equal(receipt.headers['content-type'], 'image/png');
    assert.equal(receipt.headers['x-content-type-options'], 'nosniff');
    assert.match(String(receipt.headers['content-disposition']), /^inline; filename="receipt-/);
    assert.equal(sha256(receipt.rawPayload), sha256(PNG));
    assert.equal((await as('b', 'GET', `/api/expenses/${receiptExpenseId}/receipt`)).statusCode, 404);
    assert.equal((await as('a', 'GET', `/api/expenses/${overheadId}/receipt`)).statusCode, 404);

    // ── Brand logo: stored, served to its organization, replaced cleanly ────
    const logo1 = await multipartBody('logo.png', 'image/png', LOGO_1);
    const firstLogo = await app.inject({ method: 'POST', url: '/api/brand/logo', payload: logo1.payload, headers: { 'content-type': logo1.contentType, 'x-test-user': 'a' } });
    assert.equal(firstLogo.statusCode, 200, firstLogo.body);
    const firstLogoUrl = firstLogo.json().logoUrl;
    assert.match(firstLogoUrl, /^\/uploads\/brand\/logo-[0-9a-f-]{36}\.png$/);
    const servedLogo = await as('a', 'GET', '/api/brand/logo');
    assert.equal(servedLogo.statusCode, 200, servedLogo.body);
    assert.equal(servedLogo.headers['content-type'], 'image/png');
    assert.equal(sha256(servedLogo.rawPayload), sha256(LOGO_1));
    assert.equal((await as('b', 'GET', '/api/brand/logo')).statusCode, 404);

    const logo2 = await multipartBody('logo.png', 'image/png', LOGO_2);
    const secondLogo = await app.inject({ method: 'POST', url: '/api/brand/logo', payload: logo2.payload, headers: { 'content-type': logo2.contentType, 'x-test-user': 'a' } });
    assert.equal(secondLogo.statusCode, 200, secondLogo.body);
    assert.equal(sha256((await as('a', 'GET', '/api/brand/logo')).rawPayload), sha256(LOGO_2));
    await assert.rejects(fs.access(path.join(uploadsDir, firstLogoUrl.slice('/uploads/'.length))), /ENOENT/);
  } finally {
    await app?.close();
    await raw.expense.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.brandSettings.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.project.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.client.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await raw.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await raw.$disconnect();
    await fs.rm(uploadsDir, { recursive: true, force: true });
  }
});
