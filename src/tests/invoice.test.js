// Invoice module tests — Node.js built-in test runner
// Run: node --test src/tests/invoice.test.js

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { PrismaClient } from '@prisma/client';
import invoiceRoutes from '../routes/invoice.routes.js';

// ─── Setup ────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient();
let fastify;
let authToken;
let testClientId;
let testUserId;
let createdInvoiceId;
let createdInvoiceNumber;

before(async () => {
  fastify = Fastify({ logger: false });
  await fastify.register(cookie);
  await fastify.register(jwt, {
    secret: 'test-secret',
    cookie: { cookieName: 'token', signed: false }
  });

  fastify.decorate('prisma', prisma);

  fastify.decorate('authenticate', async (request, reply) => {
    try { await request.jwtVerify(); }
    catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  fastify.decorate('adminOnly', async (request, reply) => {
    try {
      await request.jwtVerify();
      if (request.user?.role !== 'ADMIN') return reply.status(403).send({ error: 'Admin required' });
    } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
  });

  await fastify.register(invoiceRoutes, { prefix: '/api/invoices' });
  await fastify.ready();

  // Create test user + client
  const user = await prisma.user.upsert({
    where: { email: 'test-invoice@ashbi.ca' },
    update: {},
    create: {
      email: 'test-invoice@ashbi.ca',
      name: 'Test User',
      password: 'hashed',
      role: 'ADMIN',
    }
  });
  testUserId = user.id;

  const client = await prisma.client.create({
    data: {
      name: 'Test Client — Invoice Suite',
      contacts: {
        create: [{
          name: 'Jane Test',
          email: 'jane@testclient.com',
          isPrimary: true,
        }]
      }
    }
  });
  testClientId = client.id;

  authToken = fastify.jwt.sign({ id: user.id, email: user.email, role: 'ADMIN' });
});

after(async () => {
  // Cleanup
  await prisma.invoicePayment.deleteMany({ where: { invoice: { clientId: testClientId } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { clientId: testClientId } } });
  await prisma.invoice.deleteMany({ where: { clientId: testClientId } });
  await prisma.lineItemTemplate.deleteMany({ where: { name: { startsWith: 'Test Template' } } });
  await prisma.contact.deleteMany({ where: { clientId: testClientId } });
  await prisma.client.delete({ where: { id: testClientId } });
  await prisma.user.delete({ where: { id: testUserId } });
  await prisma.$disconnect();
  await fastify.close();
});

function authHeader() {
  return { Authorization: `Bearer ${authToken}` };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Invoice CRUD', () => {

  test('POST /api/invoices — create invoice with all fields', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        clientId: testClientId,
        title: 'April 2026 Retainer',
        dueDate: '2026-04-30',
        taxRate: 13,
        taxType: 'HST',
        discountAmount: 100,
        notes: 'Net 30 payment terms',
        internalNotes: 'Client always pays late',
        isRecurring: true,
        recurringInterval: 'MONTHLY',
        lineItems: [
          { description: 'Brand Strategy', itemType: 'LABOR', quantity: 10, unitPrice: 150 },
          { description: 'Design Assets', itemType: 'MATERIALS', quantity: 1, unitPrice: 500 },
          { description: 'Travel Expense', itemType: 'EXPENSE', quantity: 1, unitPrice: 75.50 },
        ],
      },
    });

    assert.equal(res.statusCode, 200, `Expected 200, got ${res.statusCode}: ${res.body}`);
    const body = JSON.parse(res.body);

    assert.ok(body.id, 'Should have an id');
    assert.match(body.invoiceNumber, /^INV-\d{4}-\d{4}$/, 'Invoice number should match format');
    assert.equal(body.status, 'DRAFT');
    assert.equal(body.title, 'April 2026 Retainer');
    assert.equal(body.isRecurring, true);
    assert.equal(body.recurringInterval, 'MONTHLY');
    assert.equal(body.taxType, 'HST');
    assert.equal(body.taxRate, 13);
    assert.equal(body.lineItems.length, 3);
    assert.equal(body.discountAmount, 100);

    // subtotal = (10*150) + (1*500) + (1*75.50) = 1500+500+75.5 = 2075.50
    // discounted = 2075.50 - 100 = 1975.50
    // tax = 1975.50 * 0.13 = 256.815 => 256.82
    // total = 1975.50 + 256.82 = 2232.32
    assert.equal(body.subtotal, 2075.5);
    assert.ok(body.tax > 0, 'Tax should be calculated');
    assert.ok(body.total > body.subtotal - 100, 'Total should be > (subtotal - discount)');

    createdInvoiceId = body.id;
    createdInvoiceNumber = body.invoiceNumber;
    console.log(`  ✓ Created invoice ${createdInvoiceNumber}`);
  });

  test('GET /api/invoices — list with stats', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/invoices',
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body.invoices), 'Should return invoices array');
    assert.ok(body.stats, 'Should return stats');
    assert.ok(body.stats.draft, 'Stats should include draft');
    assert.ok(body.stats.paid, 'Stats should include paid');
    console.log(`  ✓ Listed ${body.invoices.length} invoices, stats: ${JSON.stringify(body.stats)}`);
  });

  test('GET /api/invoices?status=DRAFT — filter by status', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/invoices?status=DRAFT',
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const allDraft = body.invoices.every(i => i.status === 'DRAFT');
    assert.ok(allDraft, 'All returned invoices should be DRAFT');
    console.log(`  ✓ Filter by status: ${body.invoices.length} draft invoices`);
  });

  test('GET /api/invoices?clientId=X — filter by client', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: `/api/invoices?clientId=${testClientId}`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const allClient = body.invoices.every(i => i.client.id === testClientId || i.clientId === testClientId);
    assert.ok(allClient, 'All returned invoices should be for the filtered client');
    console.log(`  ✓ Filter by client: ${body.invoices.length} invoices`);
  });

  test('GET /api/invoices/:id — detail view', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'GET',
      url: `/api/invoices/${createdInvoiceId}`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, createdInvoiceId);
    assert.ok(Array.isArray(body.lineItems), 'Should include line items');
    assert.ok(body.client, 'Should include client');
    assert.ok(body.client.contacts, 'Should include client contacts');
    assert.ok(Array.isArray(body.payments), 'Should include payments');
    console.log(`  ✓ Detail view: ${body.invoiceNumber}, ${body.lineItems.length} line items`);
  });

  test('PUT /api/invoices/:id — update line items', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'PUT',
      url: `/api/invoices/${createdInvoiceId}`,
      headers: authHeader(),
      payload: {
        title: 'Updated: April 2026 Retainer',
        notes: 'Updated payment terms: Net 15',
        discountAmount: 200,
        lineItems: [
          { description: 'Brand Strategy (revised)', itemType: 'LABOR', quantity: 12, unitPrice: 150 },
          { description: 'Design Assets (full set)', itemType: 'MATERIALS', quantity: 1, unitPrice: 800 },
        ],
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.title, 'Updated: April 2026 Retainer');
    assert.equal(body.lineItems.length, 2, 'Should have 2 line items after update');
    assert.equal(body.discountAmount, 200);

    // subtotal = (12*150) + (1*800) = 1800+800 = 2600
    assert.equal(body.subtotal, 2600);
    console.log(`  ✓ Updated invoice: subtotal=${body.subtotal}, total=${body.total}`);
  });

  test('POST /api/invoices/templates — create line item template', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: '/api/invoices/templates',
      headers: authHeader(),
      payload: {
        name: 'Test Template: Branding Retainer',
        description: 'Monthly brand management services',
        itemType: 'LABOR',
        unitPrice: 999,
        unit: 'flat',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Test Template: Branding Retainer');
    assert.equal(body.unitPrice, 999);
    console.log(`  ✓ Created line item template: ${body.name}`);
  });

  test('GET /api/invoices/templates — list templates', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/invoices/templates',
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body), 'Should return array');
    console.log(`  ✓ Listed ${body.length} templates`);
  });

  test('POST /api/invoices/:id/send — send invoice (stub)', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/invoices/${createdInvoiceId}/send`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'SENT');
    assert.ok(body.sentAt, 'sentAt should be set');
    console.log(`  ✓ Sent invoice ${body.invoiceNumber}, emailSent=${body.emailSent}`);
  });

  test('POST /api/invoices/:id/send — cannot send already-sent invoice', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/invoices/${createdInvoiceId}/send`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 400);
    console.log('  ✓ Correctly rejected double-send');
  });

  test('POST /api/invoices/:id/pdf — generate PDF/HTML', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/invoices/${createdInvoiceId}/pdf`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type']?.includes('text/html'), 'Should return HTML');
    assert.ok(res.body.includes('Ashbi Design'), 'PDF HTML should contain company name');
    assert.ok(res.body.includes(createdInvoiceNumber), 'PDF HTML should contain invoice number');
    console.log(`  ✓ Generated PDF HTML (${res.body.length} chars)`);
  });

  test('POST /api/invoices/:id/mark-paid — mark paid with payment details', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'POST',
      url: `/api/invoices/${createdInvoiceId}/mark-paid`,
      headers: authHeader(),
      payload: {
        paymentMethod: 'BANK',
        paymentNotes: 'Received via e-Transfer',
        transactionId: 'ETRANSFER-12345',
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'PAID');
    assert.ok(body.paidAt, 'paidAt should be set');
    assert.equal(body.paymentMethod, 'BANK');
    console.log(`  ✓ Marked as paid: ${body.status}, paidAt=${body.paidAt}`);
  });

  test('GET /api/invoices/:id/payments — payment history', async () => {
    assert.ok(createdInvoiceId, 'Invoice must have been created first');

    const res = await fastify.inject({
      method: 'GET',
      url: `/api/invoices/${createdInvoiceId}/payments`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body), 'Should return array');
    assert.ok(body.length > 0, 'Should have at least one payment record');
    assert.equal(body[0].method, 'BANK');
    assert.equal(body[0].transactionId, 'ETRANSFER-12345');
    console.log(`  ✓ Payment history: ${body.length} records`);
  });

  test('POST /api/invoices/:id/mark-paid — cannot pay already-paid invoice', async () => {
    const res = await fastify.inject({
      method: 'POST',
      url: `/api/invoices/${createdInvoiceId}/mark-paid`,
      headers: authHeader(),
      payload: { paymentMethod: 'CASH' },
    });

    assert.equal(res.statusCode, 400);
    console.log('  ✓ Correctly rejected double-payment');
  });

  test('GET /api/invoices/stats — collections dashboard data', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/invoices/stats',
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok('paid' in body, 'Stats should include paid');
    assert.ok('draft' in body, 'Stats should include draft');
    assert.ok('sent' in body, 'Stats should include sent');
    assert.ok('overdue' in body, 'Stats should include overdue');
    assert.ok('totalOutstanding' in body, 'Stats should include totalOutstanding');
    assert.ok(body.paid.count > 0, 'Should have at least one paid invoice');
    console.log(`  ✓ Stats: ${JSON.stringify(body)}`);
  });

  test('DELETE /api/invoices/:id — cannot void a paid invoice', async () => {
    const res = await fastify.inject({
      method: 'DELETE',
      url: `/api/invoices/${createdInvoiceId}`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 400);
    console.log('  ✓ Correctly rejected void of paid invoice');
  });

  test('DELETE /api/invoices/:id — void a draft invoice', async () => {
    // Create a new draft invoice to void
    const createRes = await fastify.inject({
      method: 'POST',
      url: '/api/invoices',
      headers: authHeader(),
      payload: {
        clientId: testClientId,
        lineItems: [{ description: 'To be voided', itemType: 'CUSTOM', quantity: 1, unitPrice: 100 }],
      },
    });
    const draftId = JSON.parse(createRes.body).id;

    const res = await fastify.inject({
      method: 'DELETE',
      url: `/api/invoices/${draftId}`,
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, 'VOID');
    console.log('  ✓ Voided draft invoice');
  });

  test('GET /api/invoices?status=PAID — filter paid', async () => {
    const res = await fastify.inject({
      method: 'GET',
      url: '/api/invoices?status=PAID',
      headers: authHeader(),
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const allPaid = body.invoices.every(i => i.status === 'PAID');
    assert.ok(allPaid, 'All filtered invoices should be PAID');
    console.log(`  ✓ Filter PAID: ${body.invoices.length} paid invoices`);
  });

  test('GET /api/invoices/client/:viewToken — public client view', async () => {
    // Get the paid invoice's viewToken
    const invoice = await prisma.invoice.findUnique({ where: { id: createdInvoiceId } });
    assert.ok(invoice.viewToken, 'Invoice should have a viewToken');

    const res = await fastify.inject({
      method: 'GET',
      url: `/api/invoices/client/${invoice.viewToken}`,
      // No auth header — public route
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.id, createdInvoiceId);
    assert.ok(!('internalNotes' in body), 'Internal notes should not be exposed publicly');
    console.log('  ✓ Public client view works (no auth required)');
  });

});
