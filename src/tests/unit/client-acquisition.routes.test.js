import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import clientAcquisitionRoutes from '../../routes/client-acquisition.routes.js';
import {
  canonicalPayloadHash,
  clientAcquisitionCorsOptions,
  intakeSchema,
  loadClientAcquisitionConfig,
} from '../../services/client-acquisition.contract.js';

const ORIGIN = 'https://ashbi.ca';
const env = {
  CLIENT_ACQUISITION_ORGANIZATION_ID: 'org-1',
  CLIENT_ACQUISITION_OWNER_ID: 'owner-1',
  CLIENT_ACQUISITION_PRIVACY_VERSION: '2026-09-01',
  CLIENT_ACQUISITION_SERVICE_LINES: 'web_commerce, brand_packaging',
  CLIENT_ACQUISITION_ALLOWED_ORIGINS: 'https://ashbi.ca,https://www.ashbi.ca',
};
const enabledConfig = loadClientAcquisitionConfig(env);

function validInquiry(overrides = {}) {
  return {
    idempotencyKey: 'ashbi_ca:6f1c2a4e-9b7d-4e2a-8c1f-3d5e7a9b0c2d',
    name: 'Jordan Rivera',
    email: 'Jordan@Example.com',
    company: 'Rivera Co',
    serviceLine: 'web_commerce',
    businessContext: 'We sell handmade furniture online.',
    requestedOutcome: 'A faster storefront.',
    timing: 'one_to_three_months',
    budgetBand: '10k_25k',
    budgetCurrency: 'CAD',
    consent: true,
    privacyVersion: '2026-09-01',
    attribution: {
      landingPage: '/contact/',
      referrer: 'https://news.example.com/article?token=secret#frag',
      source: 'newsletter',
      medium: 'email',
      campaign: 'fall/2026 launch',
      clickId: 'Cj0KCQjw-abc_123',
    },
    ...overrides,
  };
}

function fakePrisma({ owner = { id: 'owner-1' } } = {}) {
  const rows = [];
  const notifications = [];
  const prisma = {
    rows,
    notifications,
    user: {
      findFirst: async ({ where }) => (owner && where.id === owner.id && where.organizationId === 'org-1' ? owner : null),
    },
    publicInquiry: {
      findUnique: async ({ where }) => {
        const key = where.organizationId_idempotencyKey;
        return rows.find((row) => row.organizationId === key.organizationId && row.idempotencyKey === key.idempotencyKey) ?? null;
      },
      create: async ({ data }) => {
        if (rows.some((row) => row.organizationId === data.organizationId && row.idempotencyKey === data.idempotencyKey)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        const row = { id: `inq-${rows.length + 1}`, ...data };
        rows.push(row);
        return { id: row.id };
      },
    },
    notification: { create: async ({ data }) => { notifications.push(data); return data; } },
  };
  prisma.$transaction = async (callback) => callback(prisma);
  return prisma;
}

async function buildApp({ config = enabledConfig, prisma = fakePrisma(), withCors = false } = {}) {
  const app = Fastify();
  if (withCors) {
    await app.register(cors, {
      delegator: (_request, callback) => callback(null, clientAcquisitionCorsOptions(config)),
    });
  }
  app.decorate('prisma', prisma);
  app.decorate('authenticate', async () => {});
  app.decorate('adminOnly', async () => {});
  await app.register(clientAcquisitionRoutes, { prefix: '/api/client-acquisition', config });
  return app;
}

const post = (app, payload, headers = { origin: ORIGIN }) => app.inject({
  method: 'POST', url: '/api/client-acquisition/intake', payload, headers,
});

test('config fails closed and exposes nothing when any setting is missing', async (t) => {
  for (const missing of Object.keys(env)) {
    const config = loadClientAcquisitionConfig({ ...env, [missing]: '' });
    assert.equal(config.enabled, false, `${missing} must be required`);
    const app = await buildApp({ config });
    t.after(() => app.close());
    const response = await app.inject({ method: 'GET', url: '/api/client-acquisition/config' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { enabled: false, privacyVersion: null, serviceLines: [] });
  }
});

test('config returns the active privacy version and service lines without identifiers', async (t) => {
  const app = await buildApp();
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/api/client-acquisition/config' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { enabled: true, privacyVersion: '2026-09-01', serviceLines: ['web_commerce', 'brand_packaging'] });
  assert.doesNotMatch(response.body, /org-1|owner-1|ashbi\.ca/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('intake is unavailable while the gate is disabled', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ config: loadClientAcquisitionConfig({}), prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry());
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, 'INTAKE_UNAVAILABLE');
  assert.equal(prisma.rows.length, 0);
});

test('a valid inquiry creates one organization-owned record for the configured owner', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry());
  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.json(), { accepted: true, replayed: false });
  assert.equal(prisma.rows.length, 1);
  const [row] = prisma.rows;
  assert.equal(row.organizationId, 'org-1');
  assert.equal(row.ownerId, 'owner-1');
  assert.equal(row.email, 'jordan@example.com');
  assert.equal(row.privacyVersion, '2026-09-01');
  assert.ok(row.consentedAt instanceof Date);
  assert.deepEqual(row.attribution, {
    landingPage: '/contact/',
    referrer: 'https://news.example.com/article',
    source: 'newsletter',
    medium: 'email',
    campaign: 'fall/2026 launch',
    clickId: 'Cj0KCQjw-abc_123',
  });
  assert.equal(prisma.notifications.length, 1);
  assert.equal(prisma.notifications[0].userId, 'owner-1');
});

test('replaying the same key and payload reuses the inquiry without a second notification', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  assert.equal((await post(app, validInquiry())).statusCode, 201);
  const replay = await post(app, validInquiry({ email: 'jordan@example.com ' }));
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), { accepted: true, replayed: true });
  assert.equal(prisma.rows.length, 1);
  assert.equal(prisma.notifications.length, 1);
});

test('reusing a key for a different payload conflicts and keeps the original', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  await post(app, validInquiry());
  const conflict = await post(app, validInquiry({ requestedOutcome: 'Something else entirely.' }));
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(prisma.rows.length, 1);
  assert.equal(prisma.rows[0].requestedOutcome, 'A faster storefront.');
});

test('a concurrent insert with the same key resolves as a replay', async (t) => {
  const prisma = fakePrisma();
  const originalFind = prisma.publicInquiry.findUnique;
  let first = true;
  prisma.publicInquiry.findUnique = async (args) => {
    if (first) { first = false; return null; }
    return originalFind(args);
  };
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const input = intakeSchema.parse(validInquiry());
  prisma.rows.push({ organizationId: 'org-1', idempotencyKey: input.idempotencyKey, payloadHash: canonicalPayloadHash(input) });
  const response = await post(app, validInquiry());
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().replayed, true);
});

test('a stale privacy version returns the stable PRIVACY_VERSION_CHANGED contract', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry({ privacyVersion: '2025-01-01' }));
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().code, 'PRIVACY_VERSION_CHANGED');
  assert.equal(response.json().privacyVersion, '2026-09-01');
  assert.equal(prisma.rows.length, 0);
});

test('invalid inquiries fail safely without storing anything', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const cases = [
    [{ serviceLine: 'crypto-mining' }, 'serviceLine'],
    [{ email: 'not-an-email' }, 'email'],
    [{ consent: false }, 'consent'],
    [{ consent: undefined }, 'consent'],
    [{ name: 'x'.repeat(201) }, 'name'],
    [{ budgetCurrency: 'EUR' }, 'budgetCurrency'],
    [{ budgetCurrency: undefined }, 'budgetCurrency'],
    [{ budgetBand: undefined }, 'budgetCurrency'],
    [{ timing: 'yesterday' }, 'timing'],
    [{ budgetBand: 'a-million' }, 'budgetBand'],
    [{ attribution: { referrer: 'javascript:alert(1)' } }, 'attribution.referrer'],
    [{ attribution: { landingPage: 'https://evil.example/' } }, 'attribution.landingPage'],
    [{ attribution: { landingPage: '//evil.example/' } }, 'attribution.landingPage'],
    [{ attribution: { source: 'x'.repeat(101) } }, 'attribution.source'],
    [{ attribution: { tracker: 'unexpected' } }, 'attribution'],
    [{ organizationId: 'org-2' }, '(body)'],
    [{ idempotencyKey: 'short' }, 'idempotencyKey'],
  ];
  for (const [overrides, field] of cases) {
    const response = await post(app, validInquiry(overrides));
    assert.equal(response.statusCode, 400, JSON.stringify(overrides));
    assert.equal(response.json().code, 'INVALID_INQUIRY');
    assert.ok(response.json().fields.includes(field), `${JSON.stringify(overrides)} -> ${response.json().fields}`);
  }
  assert.equal(prisma.rows.length, 0);
});

test('accepts every timing and budget value ashbi.ca can send', () => {
  for (const timing of ['urgent_30_days', 'one_to_three_months', 'three_to_six_months', 'exploring']) {
    assert.equal(intakeSchema.parse(validInquiry({ timing })).timing, timing);
  }
  // The form sends its currency select (default CAD) with every band, including
  // the bands without an amount.
  for (const budgetBand of ['under_5k', '5k_10k', '10k_25k', '25k_plus', 'not_sure', 'prefer_not_to_say']) {
    assert.equal(intakeSchema.parse(validInquiry({ budgetBand, budgetCurrency: 'CAD' })).budgetBand, budgetBand);
  }
  const noBudget = intakeSchema.parse(validInquiry({ budgetBand: undefined, budgetCurrency: undefined, timing: undefined }));
  assert.equal(noBudget.budgetBand, null);
  assert.equal(noBudget.budgetCurrency, null);
});

test('accepts a minimal ashbi.ca payload with only required fields', () => {
  // JSON.stringify drops the undefined optionals createHubInquiryPayload leaves.
  const minimal = JSON.parse(JSON.stringify(validInquiry({
    company: undefined, phone: undefined, timing: undefined, budgetBand: undefined, budgetCurrency: undefined,
    website: undefined, attribution: { landingPage: '/contact/' },
  })));
  assert.equal(intakeSchema.safeParse(minimal).success, true);
});

test('oversized bodies are rejected before parsing', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry({ businessContext: 'x'.repeat(20_000) }));
  assert.equal(response.statusCode, 413);
  assert.equal(prisma.rows.length, 0);
});

test('intake rejects requests from unapproved or missing origins', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  for (const headers of [{ origin: 'https://evil.example' }, {}]) {
    const response = await post(app, validInquiry(), headers);
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().code, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal(prisma.rows.length, 0);
});

test('CORS allows only approved origins and never credentials', async (t) => {
  const app = await buildApp({ withCors: true });
  t.after(() => app.close());
  const preflight = (origin) => app.inject({
    method: 'OPTIONS', url: '/api/client-acquisition/intake',
    headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
  });
  const allowed = await preflight('https://www.ashbi.ca');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://www.ashbi.ca');
  assert.equal(allowed.headers['access-control-allow-credentials'], undefined);
  const denied = await preflight('https://evil.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('the honeypot answers like success but stores nothing', async (t) => {
  const prisma = fakePrisma();
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry({ website: 'https://spam.example' }));
  assert.equal(response.statusCode, 202);
  assert.equal(response.json().accepted, true);
  assert.equal(prisma.rows.length, 0);
  assert.equal(prisma.notifications.length, 0);
});

test('a misconfigured owner fails closed', async (t) => {
  const prisma = fakePrisma({ owner: null });
  const app = await buildApp({ prisma });
  t.after(() => app.close());
  const response = await post(app, validInquiry());
  assert.equal(response.statusCode, 503);
  assert.equal(prisma.rows.length, 0);
});

test('public intake never triggers consequential actions', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../routes/client-acquisition.routes.js', import.meta.url), 'utf8');
  for (const forbidden of ['client.create', 'proposal', 'invoice.create', 'stripe', 'sendEmail', 'mailgun', 'queueEmail']) {
    assert.equal(source.includes(forbidden), false, `intake route must not reference ${forbidden}`);
  }
});

test('free text drops control characters but keeps line breaks', () => {
  const parsed = intakeSchema.parse(validInquiry({ name: ' Jordan\u0000 Rivera\u007F ', businessContext: 'Line one\nLine two' }));
  assert.equal(parsed.name, 'Jordan Rivera');
  assert.equal(parsed.businessContext, 'Line one\nLine two');
});

test('blank optional fields are stored as null', () => {
  const parsed = intakeSchema.parse(validInquiry({ company: '   ', phone: '' }));
  assert.equal(parsed.company, null);
  assert.equal(parsed.phone, null);
});
