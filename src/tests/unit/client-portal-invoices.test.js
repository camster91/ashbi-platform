// Client portal invoices (H12) and pay links (H10): the portal lists only
// invoices the client has actually been sent (never drafts), never offers to
// pay a void or draft invoice, and every Pay action goes through the public
// invoice page — which creates or refreshes a Stripe Checkout session on
// demand — instead of a stored Checkout URL that expires within 24 hours.
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import Fastify from 'fastify';
import clientPortalRoutes from '../../routes/client-portal.routes.js';
import { buildInvoiceDeliveryEmail } from '../../services/email.service.js';

const DAY = 24 * 60 * 60 * 1000;
const issued = { publicAccessExpiresAt: new Date(Date.now() + 30 * DAY), publicAccessRevokedAt: null };
const INVOICES = [
  { id: 'draft', invoiceNumber: 'INV-1', status: 'DRAFT', viewToken: 'tok-draft', stripePaymentLink: null, publicAccessExpiresAt: null, publicAccessRevokedAt: null },
  { id: 'sent', invoiceNumber: 'INV-2', status: 'SENT', viewToken: 'tok-sent', stripePaymentLink: 'https://checkout.stripe.test/expired', ...issued },
  { id: 'overdue', invoiceNumber: 'INV-3', status: 'OVERDUE', viewToken: 'tok-overdue', stripePaymentLink: null, ...issued },
  { id: 'paid', invoiceNumber: 'INV-4', status: 'PAID', viewToken: 'tok-paid', stripePaymentLink: null, paidAt: new Date(), ...issued },
  { id: 'void', invoiceNumber: 'INV-5', status: 'VOID', viewToken: 'tok-void', stripePaymentLink: null, ...issued },
  { id: 'revoked', invoiceNumber: 'INV-6', status: 'SENT', viewToken: 'tok-revoked', stripePaymentLink: null, publicAccessExpiresAt: issued.publicAccessExpiresAt, publicAccessRevokedAt: new Date() },
].map((invoice) => ({ clientId: 'client-a', total: 100, currency: 'CAD', issueDate: new Date(), dueDate: null, title: null, notes: null, ...invoice }));

function select(row, fields) {
  if (!fields) return row;
  return Object.fromEntries(Object.keys(fields).filter((key) => fields[key]).map((key) => [key, row[key]]));
}

describe('client portal invoices', () => {
  let app;
  const user = {
    id: 'portal-user', email: 'client@example.com', name: 'Client User', role: 'CLIENT',
    clientId: 'client-a', organizationId: 'org-a', isActive: true, sessionVersion: 1,
  };

  before(async () => {
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(jwt, { secret: 'portal-invoices-test-secret', cookie: { cookieName: 'token', signed: false } });
    const prisma = {
      user: { findUnique: async ({ where }) => (where.id === user.id ? user : null) },
      contact: { findFirst: async () => ({ id: 'contact-a', clientId: 'client-a', email: user.email, name: user.name }) },
      client: { findFirst: async () => ({ id: 'client-a', organizationId: 'org-a', name: 'Client A' }) },
      invoice: {
        findMany: async ({ where, select: fields }) => INVOICES
          .filter((invoice) => invoice.clientId === where.clientId)
          .filter((invoice) => !where.status?.in || where.status.in.includes(invoice.status))
          .map((invoice) => select(invoice, fields)),
      },
    };
    app.decorate('prisma', prisma);
    app.decorate('io', { to: () => ({ emit: () => {} }) });
    app.addHook('preHandler', async (request) => { request.prisma = prisma; });
    await app.register(clientPortalRoutes, { prefix: '/api/client-portal' });
    await app.ready();
  });

  after(async () => app.close());

  it('lists sent, overdue and paid invoices only, and links Pay to the public invoice page', async () => {
    const bearer = app.jwt.sign({ ...user, contactId: 'contact-a' }, { expiresIn: '1h' });
    const response = await app.inject({ method: 'GET', url: '/api/client-portal/invoices', headers: { authorization: `Bearer ${bearer}` } });
    assert.equal(response.statusCode, 200, response.body);
    const invoices = response.json();
    assert.deepEqual(invoices.map((invoice) => invoice.id).sort(), ['overdue', 'paid', 'revoked', 'sent']);
    for (const invoice of invoices) assert.equal('stripePaymentLink' in invoice, false, 'no stored Checkout URL is exposed');

    const byId = Object.fromEntries(invoices.map((invoice) => [invoice.id, invoice]));
    assert.equal(byId.sent.payUrl, '/portal/invoice/tok-sent');
    assert.equal(byId.overdue.payUrl, '/portal/invoice/tok-overdue');
    assert.equal(byId.paid.payUrl, null, 'paid invoices are never payable');
    assert.equal(byId.revoked.payUrl, null, 'a revoked link is never handed out');
    assert.equal(byId.paid.viewUrl, '/portal/invoice/tok-paid', 'the receipt stays viewable');
  });
});

describe('invoice email pay link', () => {
  it('always points at the public invoice page, never a stored Checkout URL', () => {
    const email = buildInvoiceDeliveryEmail({
      to: 'client@example.test', invoiceNumber: 'INV-9', total: 10,
      viewUrl: 'https://hub.example.test/portal/invoice/token-9',
      paymentLink: 'https://checkout.stripe.test/c/pay/cs_expiring',
    });
    assert.equal(email.variables.payLink, 'https://hub.example.test/portal/invoice/token-9');
  });
});
