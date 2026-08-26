import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { publicInquirySchema } from '../../validators/schemas.js';
import { createPublicInquiry, normalizePublicInquiry } from '../../services/public-inquiry.service.js';
import clientAcquisitionRoutes from '../../routes/client-acquisition.routes.js';

const validInquiry = {
  idempotencyKey: 'inquiry-20260826-0001',
  name: 'Casey Founder',
  email: 'casey@example.com',
  company: 'Example Foods',
  serviceLine: 'brand_packaging',
  businessContext: 'We are preparing a new packaged product for retail launch.',
  requestedOutcome: 'Create a coherent identity and production-ready package system.',
  timing: 'one_to_three_months',
  budgetBand: '10k_25k',
  budgetCurrency: 'CAD',
  consent: true,
  privacyVersion: '2026-08-26',
  attribution: {
    landingPage: '/services/brand-packaging',
    source: 'referral',
    medium: 'partner',
    campaign: 'summer-launch',
  },
};

test('public inquiry schema accepts the canonical service and consent contract', () => {
  const result = publicInquirySchema.safeParse(validInquiry);
  assert.equal(result.success, true);
});

test('public inquiry schema rejects unsupported services and absent consent', () => {
  const result = publicInquirySchema.safeParse({
    ...validInquiry,
    serviceLine: 'generic_ai_transformation',
    consent: false,
  });
  assert.equal(result.success, false);
});

test('public inquiry normalization removes URL query data and stabilizes identity fields', () => {
  const normalized = normalizePublicInquiry({
    ...validInquiry,
    name: '  Casey Founder  ',
    email: 'CASEY@Example.com ',
    attribution: {
      ...validInquiry.attribution,
      referrer: 'https://partner.example/path?email=private@example.com#details',
    },
  });

  assert.equal(normalized.name, 'Casey Founder');
  assert.equal(normalized.email, 'casey@example.com');
  assert.equal(normalized.attribution.referrer, 'https://partner.example/path');
  assert.match(normalized.payloadHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(normalized, 'website'), false);
});

test('public inquiry persistence creates one tenant-scoped lead, audit event, and owner notification', async () => {
  const writes = { leads: [], events: [], notifications: [] };
  const transaction = {
    user: { findFirst: async () => ({ id: 'owner-1' }) },
    lead: {
      findUnique: async () => null,
      create: async ({ data }) => {
        writes.leads.push(data);
        return { id: 'lead-1', ...data };
      },
    },
    leadEvent: { create: async ({ data }) => writes.events.push(data) },
    notification: { create: async ({ data }) => writes.notifications.push(data) },
  };
  const prisma = { $transaction: async (operation) => operation(transaction) };
  const now = new Date('2026-08-26T20:30:00.000Z');

  const result = await createPublicInquiry({
    prisma,
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    inquiry: publicInquirySchema.parse(validInquiry),
    now,
  });

  assert.deepEqual(result, { id: 'lead-1', idempotent: false });
  assert.equal(writes.leads.length, 1);
  assert.equal(writes.leads[0].organizationId, 'org-1');
  assert.equal(writes.leads[0].consentAt, now);
  assert.equal(writes.events[0].eventName, 'inquiry_submitted');
  assert.deepEqual(writes.events[0].properties, {
    serviceLine: 'brand_packaging',
    source: 'referral',
    medium: 'partner',
    campaign: 'summer-launch',
  });
  assert.equal(writes.notifications[0].userId, 'owner-1');
  assert.equal(writes.notifications[0].data.leadId, 'lead-1');
});

test('replaying the same inquiry key and payload returns the original lead without duplicate writes', async () => {
  const normalized = normalizePublicInquiry(publicInquirySchema.parse(validInquiry));
  let createCalls = 0;
  const transaction = {
    user: { findFirst: async () => ({ id: 'owner-1' }) },
    lead: {
      findUnique: async () => ({ id: 'lead-existing', intakePayloadHash: normalized.payloadHash }),
      create: async () => { createCalls += 1; },
    },
    leadEvent: { create: async () => { createCalls += 1; } },
    notification: { create: async () => { createCalls += 1; } },
  };

  const result = await createPublicInquiry({
    prisma: { $transaction: async (operation) => operation(transaction) },
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    inquiry: publicInquirySchema.parse(validInquiry),
  });

  assert.deepEqual(result, { id: 'lead-existing', idempotent: true });
  assert.equal(createCalls, 0);
});

test('reusing an inquiry key for different content fails without overwriting the original lead', async () => {
  let createCalls = 0;
  const transaction = {
    user: { findFirst: async () => ({ id: 'owner-1' }) },
    lead: {
      findUnique: async () => ({ id: 'lead-existing', intakePayloadHash: 'different-hash' }),
      create: async () => { createCalls += 1; return { id: 'unexpected' }; },
    },
    leadEvent: { create: async () => { createCalls += 1; } },
    notification: { create: async () => { createCalls += 1; } },
  };

  await assert.rejects(
    createPublicInquiry({
      prisma: { $transaction: async (operation) => operation(transaction) },
      organizationId: 'org-1',
      ownerUserId: 'owner-1',
      inquiry: publicInquirySchema.parse(validInquiry),
    }),
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(createCalls, 0);
});

test('simultaneous duplicate submissions reconcile to the committed original lead', async () => {
  const normalized = normalizePublicInquiry(publicInquirySchema.parse(validInquiry));
  const transaction = {
    user: { findFirst: async () => ({ id: 'owner-1' }) },
    lead: {
      findUnique: async () => null,
      create: async () => { throw Object.assign(new Error('Unique constraint'), { code: 'P2002' }); },
    },
    leadEvent: { create: async () => ({}) },
    notification: { create: async () => ({}) },
  };
  const prisma = {
    $transaction: async (operation) => operation(transaction),
    lead: {
      findUnique: async () => ({ id: 'lead-race-winner', intakePayloadHash: normalized.payloadHash }),
    },
  };

  const result = await createPublicInquiry({
    prisma,
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    inquiry: publicInquirySchema.parse(validInquiry),
  });

  assert.deepEqual(result, { id: 'lead-race-winner', idempotent: true });
});

test('public inquiries have tenant ownership, durable events, and a unique idempotency boundary', () => {
  const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
  assert.match(schema, /model Lead \{[\s\S]*organizationId\s+String[\s\S]*intakeIdempotencyKey\s+String[\s\S]*@@unique\(\[organizationId, intakeIdempotencyKey\]\)[\s\S]*@@map\("leads"\)/);
  assert.match(schema, /model LeadEvent \{[\s\S]*organizationId\s+String[\s\S]*leadId\s+String[\s\S]*eventName\s+String[\s\S]*@@map\("lead_events"\)/);
});

test('public intake route validates and stores one inquiry without returning personal data', async (t) => {
  const transaction = {
    user: { findFirst: async () => ({ id: 'owner-1' }) },
    lead: {
      findUnique: async () => null,
      create: async ({ data }) => ({ id: 'lead-1', ...data }),
    },
    leadEvent: { create: async () => ({ id: 'event-1' }) },
    notification: { create: async () => ({ id: 'notification-1' }) },
  };
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', { $transaction: async (operation) => operation(transaction) });
  await app.register(clientAcquisitionRoutes, {
    prefix: '/api/client-acquisition',
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    privacyVersion: '2026-08-26',
    allowedOrigins: ['https://ashbi.ca'],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://ashbi.ca' },
    payload: validInquiry,
  });

  assert.equal(response.statusCode, 202, response.body);
  assert.deepEqual(response.json(), { received: true, inquiryId: 'lead-1', idempotent: false });
  assert.equal(response.body.includes('casey@example.com'), false);
});

test('public intake config exposes no tenant or owner identifiers', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  await app.register(clientAcquisitionRoutes, {
    prefix: '/api/client-acquisition',
    organizationId: 'org-private',
    ownerUserId: 'owner-private',
    privacyVersion: '2026-08-26',
    allowedOrigins: ['https://ashbi.ca'],
  });

  const response = await app.inject({ method: 'GET', url: '/api/client-acquisition/config' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().enabled, true);
  assert.equal(response.body.includes('org-private'), false);
  assert.equal(response.body.includes('owner-private'), false);
});

test('public intake fails closed when its tenant configuration is incomplete', async (t) => {
  let transactionCalls = 0;
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', { $transaction: async () => { transactionCalls += 1; } });
  await app.register(clientAcquisitionRoutes, {
    prefix: '/api/client-acquisition',
    organizationId: '',
    ownerUserId: '',
    privacyVersion: '',
    allowedOrigins: [],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://ashbi.ca' },
    payload: validInquiry,
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'INTAKE_DISABLED');
  assert.equal(transactionCalls, 0);
});

test('public intake rejects invalid payload, unapproved origin, and stale privacy consent before writing', async (t) => {
  let transactionCalls = 0;
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', { $transaction: async () => { transactionCalls += 1; } });
  await app.register(clientAcquisitionRoutes, {
    prefix: '/api/client-acquisition',
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    privacyVersion: '2026-08-26',
    allowedOrigins: ['https://ashbi.ca'],
  });

  const invalid = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://ashbi.ca' },
    payload: { ...validInquiry, consent: false },
  });
  const wrongOrigin = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://unapproved.example' },
    payload: validInquiry,
  });
  const stalePrivacy = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://ashbi.ca' },
    payload: { ...validInquiry, privacyVersion: '2026-08-25' },
  });

  assert.equal(invalid.statusCode, 400, invalid.body);
  assert.equal(wrongOrigin.statusCode, 403, wrongOrigin.body);
  assert.equal(wrongOrigin.json().code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(stalePrivacy.statusCode, 409, stalePrivacy.body);
  assert.equal(stalePrivacy.json().code, 'PRIVACY_VERSION_CHANGED');
  assert.equal(transactionCalls, 0);
});

test('public intake honeypot accepts silently without storing or echoing the submission', async (t) => {
  let transactionCalls = 0;
  const app = Fastify();
  t.after(() => app.close());
  app.decorate('prisma', { $transaction: async () => { transactionCalls += 1; } });
  await app.register(clientAcquisitionRoutes, {
    prefix: '/api/client-acquisition',
    organizationId: 'org-1',
    ownerUserId: 'owner-1',
    privacyVersion: '2026-08-26',
    allowedOrigins: ['https://ashbi.ca'],
  });

  const response = await app.inject({
    method: 'POST',
    url: '/api/client-acquisition/intake',
    headers: { origin: 'https://ashbi.ca' },
    payload: { ...validInquiry, website: 'spam.example' },
  });

  assert.equal(response.statusCode, 202);
  assert.deepEqual(response.json(), { received: true });
  assert.equal(transactionCalls, 0);
});

test('the application wires public intake only through explicit environment configuration', () => {
  const index = fs.readFileSync(path.join(process.cwd(), 'src', 'index.js'), 'utf8');
  const env = fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'env.js'), 'utf8');
  const example = fs.readFileSync(path.join(process.cwd(), '.env.example'), 'utf8');
  assert.match(index, /import clientAcquisitionRoutes from '.\/routes\/client-acquisition\.routes\.js'/);
  assert.match(index, /fastify\.register\(clientAcquisitionRoutes,[\s\S]*prefix: '\/api\/client-acquisition'/);
  assert.match(env, /publicIntakeOrganizationId:\s*process\.env\.PUBLIC_INTAKE_ORGANIZATION_ID/);
  assert.match(env, /publicIntakeOwnerUserId:\s*process\.env\.PUBLIC_INTAKE_OWNER_USER_ID/);
  assert.match(example, /^PUBLIC_INTAKE_ORGANIZATION_ID=$/m);
  assert.match(example, /^PUBLIC_INTAKE_OWNER_USER_ID=$/m);
});

test('the governed intake replaces the duplicate unmatched-email public write path', () => {
  const legacyRoutes = fs.readFileSync(path.join(process.cwd(), 'src', 'routes', 'leads.routes.js'), 'utf8');
  const tenancy = fs.readFileSync(path.join(process.cwd(), 'src', 'middleware', 'tenancy.js'), 'utf8');
  assert.doesNotMatch(legacyRoutes, /fastify\.post\('\/leads\/intake'/);
  assert.doesNotMatch(legacyRoutes, /queueEmailForProcessing/);
  assert.doesNotMatch(tenancy, /\/api\/leads\/leads\/intake/);
});

test('lead records and events participate in the Hub tenant isolation policy', () => {
  const proxy = fs.readFileSync(path.join(process.cwd(), 'src', 'utils', 'prisma-tenant-proxy.js'), 'utf8');
  assert.match(proxy, /DIRECT_SCOPED_MODELS[\s\S]*'lead', 'leadevent'/);
  assert.match(proxy, /lead:\s*\[\{ relation: 'accountOwner',[\s\S]*model: 'user'/);
  assert.match(proxy, /leadevent:\s*\[\{ relation: 'lead',[\s\S]*model: 'lead'/);
});
