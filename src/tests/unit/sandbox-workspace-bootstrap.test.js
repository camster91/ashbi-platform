import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const service = await import('../../services/sandbox-workspace.service.js').catch(() => ({}));

const validEnvironment = {
  ASHBI_SANDBOX: 'true',
  ASHBI_SANDBOX_ENVIRONMENT_ID: 'ashbi-provider-sandbox-01',
  ASHBI_SANDBOX_ORGANIZATION_SLUG: 'ashbi-provider-sandbox-01',
  ASHBI_SANDBOX_STAFF_EMAIL: 'staff+sandbox@ashbi.ca',
  ASHBI_SANDBOX_CLIENT_EMAIL: 'client+sandbox@ashbi.ca',
  ASHBI_SANDBOX_BACKUP_REFERENCE: 'backup-2026-08-27-provider-sandbox',
  ASHBI_SANDBOX_APPROVAL_REFERENCE: 'approval-2026-08-27-provider-validation',
  ASHBI_SANDBOX_STAFF_PASSWORD: 'synthetic-password-value',
  APP_URL: 'https://sandbox-hub.ashbi.ca',
  DATABASE_URL: 'postgresql://ashbi:redacted@db.internal:5432/ashbi_sandbox',
  STRIPE_SECRET_KEY: 'rk_test_redacted_for_unit_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_redacted_for_unit_test',
  MAILGUN_API_KEY: 'redacted-mailgun-test-key',
  MAILGUN_DOMAIN: 'sandbox123.mailgun.org',
};

function createHarness(seed = {}) {
  const state = {
    organization: seed.organization ?? null,
    staff: seed.staff ?? null,
    client: seed.client ?? null,
    contact: seed.contact ?? null,
    project: seed.project ?? null,
  };
  const writes = [];
  let sequence = 0;
  const nextId = (prefix) => `${prefix}-${++sequence}`;
  const prisma = {
    organization: {
      findUnique: async () => state.organization,
      create: async ({ data }) => {
        writes.push({ model: 'organization', data });
        state.organization = { id: nextId('org'), ...data };
        return state.organization;
      },
    },
    user: {
      findUnique: async () => state.staff,
      create: async ({ data }) => {
        writes.push({ model: 'user', data });
        state.staff = { id: nextId('user'), ...data };
        return state.staff;
      },
    },
    client: {
      findFirst: async () => state.client,
      create: async ({ data }) => {
        writes.push({ model: 'client', data });
        state.client = { id: nextId('client'), ...data };
        return state.client;
      },
    },
    contact: {
      findUnique: async () => state.contact,
      create: async ({ data }) => {
        writes.push({ model: 'contact', data });
        state.contact = { id: nextId('contact'), ...data };
        return state.contact;
      },
    },
    project: {
      findFirst: async () => state.project,
      create: async ({ data }) => {
        writes.push({ model: 'project', data });
        state.project = { id: nextId('project'), ...data };
        return state.project;
      },
    },
    $transaction: async (work) => work(prisma),
  };
  return { prisma, state, writes };
}

test('dry run plans a bounded synthetic workspace without hashing or writing', async () => {
  assert.equal(typeof service.bootstrapSandboxWorkspace, 'function');
  const { prisma, writes } = createHarness();
  let hashCalls = 0;

  const report = await service.bootstrapSandboxWorkspace({
    prisma,
    environment: validEnvironment,
    confirm: false,
    hashPassword: async () => { hashCalls += 1; return 'hash'; },
  });

  assert.equal(report.ready, true);
  assert.equal(report.confirmed, false);
  assert.deepEqual(report.actions.map((action) => `${action.entity}:${action.operation}`), [
    'organization:CREATE',
    'staff:CREATE',
    'client:CREATE',
    'contact:CREATE',
    'project:CREATE',
  ]);
  assert.equal(writes.length, 0);
  assert.equal(hashCalls, 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-password-value|rk_test_|whsec_|mailgun-test-key|postgresql:/);
});

test('workspace preparation does not require provider credentials before provider testing begins', async () => {
  const { prisma, writes } = createHarness();
  const environment = { ...validEnvironment };
  delete environment.STRIPE_SECRET_KEY;
  delete environment.STRIPE_WEBHOOK_SECRET;
  delete environment.MAILGUN_API_KEY;
  delete environment.MAILGUN_DOMAIN;

  const report = await service.bootstrapSandboxWorkspace({
    prisma,
    environment,
    confirm: false,
  });

  assert.equal(report.ready, true);
  assert.equal(report.confirmed, false);
  assert.equal(writes.length, 0);
});

test('confirmed bootstrap creates only the synthetic operating records and is replay safe', async () => {
  const { prisma, state, writes } = createHarness();
  const first = await service.bootstrapSandboxWorkspace({
    prisma,
    environment: validEnvironment,
    confirm: true,
    hashPassword: async (value) => `hashed:${value}`,
  });

  assert.equal(first.ready, true);
  assert.equal(first.confirmed, true);
  assert.deepEqual(writes.map(({ model }) => model), ['organization', 'user', 'client', 'contact', 'project']);
  assert.equal(state.staff.role, 'ADMIN');
  assert.equal(state.staff.password, 'hashed:synthetic-password-value');
  assert.equal(state.client.email, validEnvironment.ASHBI_SANDBOX_CLIENT_EMAIL);
  assert.equal(state.contact.isPrimary, true);
  assert.equal(state.project.organizationId, state.organization.id);
  assert.equal(state.project.clientId, state.client.id);
  assert.deepEqual(first.recordIds, {
    organizationId: state.organization.id,
    staffUserId: state.staff.id,
    clientId: state.client.id,
    contactId: state.contact.id,
    projectId: state.project.id,
  });
  assert.equal(writes.some(({ model }) => /proposal|contract|invoice|payment/i.test(model)), false);

  writes.length = 0;
  const replay = await service.bootstrapSandboxWorkspace({
    prisma,
    environment: validEnvironment,
    confirm: true,
    hashPassword: async () => { throw new Error('password should not be re-hashed'); },
  });

  assert.equal(replay.ready, true);
  assert.equal(replay.confirmed, true);
  assert.equal(writes.length, 0);
  assert.deepEqual(replay.actions.map((action) => action.operation), ['REUSE', 'REUSE', 'REUSE', 'REUSE', 'REUSE']);
  assert.deepEqual(replay.recordIds, first.recordIds);
});

test('bootstrap fails closed on production configuration, unsafe slug, weak password, or record conflicts', async () => {
  const unsafeCases = [
    { environment: { ...validEnvironment, APP_URL: 'https://hub.ashbi.ca' }, expected: 'sandbox-readiness' },
    { environment: { ...validEnvironment, ASHBI_SANDBOX_ORGANIZATION_SLUG: 'ashbi-production' }, expected: 'organization-slug' },
    { environment: { ...validEnvironment, ASHBI_SANDBOX_STAFF_PASSWORD: 'short' }, expected: 'staff-password' },
    {
      environment: {
        ...validEnvironment,
        ASHBI_SANDBOX_BACKUP_REFERENCE: '',
        ASHBI_SANDBOX_APPROVAL_REFERENCE: 'pending',
      },
      expected: 'mutation-authorization',
    },
  ];

  for (const item of unsafeCases) {
    const { prisma, writes } = createHarness();
    const report = await service.bootstrapSandboxWorkspace({
      prisma,
      environment: item.environment,
      confirm: true,
      hashPassword: async () => 'hash',
    });
    assert.equal(report.ready, false);
    assert.ok(report.checks.some((check) => check.id === item.expected && check.ok === false));
    assert.equal(writes.length, 0);
  }

  const { prisma, writes } = createHarness({
    organization: { id: 'org-other', slug: validEnvironment.ASHBI_SANDBOX_ORGANIZATION_SLUG, name: 'Different Organization' },
  });
  const conflict = await service.bootstrapSandboxWorkspace({
    prisma,
    environment: validEnvironment,
    confirm: true,
    hashPassword: async () => 'hash',
  });
  assert.equal(conflict.ready, false);
  assert.equal(conflict.checks.find((check) => check.id === 'record-conflicts')?.ok, false);
  assert.equal(writes.length, 0);
});

test('bootstrap CLI is dry-run by default and has no provider integration', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'bootstrap-sandbox-workspace.mjs'), 'utf8');
  const packageJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.match(script, /process\.argv\.includes\('--confirm'\)/);
  assert.match(script, /bootstrapSandboxWorkspace/);
  assert.doesNotMatch(script, /stripe\.|mailgun\.|fetch\(/i);
  assert.match(packageJson, /"bootstrap:sandbox-workspace": "node scripts\/bootstrap-sandbox-workspace\.mjs"/);
});

test('bootstrap CLI returns a redacted preflight failure before constructing a database client', () => {
  const script = path.join(process.cwd(), 'scripts', 'bootstrap-sandbox-workspace.mjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ASHBI_SANDBOX: 'false',
      DATABASE_URL: '',
      STRIPE_SECRET_KEY: 'sk_live_must_not_appear',
    },
  });

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.match(JSON.stringify(report), /sandbox-readiness/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /sk_live_must_not_appear/);
});

test('sandbox runbook documents dry run, exact confirmation, scope, and provider boundary', () => {
  const runbook = fs.readFileSync(path.join(process.cwd(), 'docs', 'sandbox-workspace-bootstrap.md'), 'utf8');
  const status = fs.readFileSync(path.join(process.cwd(), 'docs', 'product-status.md'), 'utf8');

  assert.match(runbook, /npm run bootstrap:sandbox-workspace(?! -- --confirm)/);
  assert.match(runbook, /npm run bootstrap:sandbox-workspace -- --confirm/);
  assert.match(runbook, /ASHBI_SANDBOX_ORGANIZATION_ID/);
  assert.match(runbook, /check:migration-sandbox-target/);
  assert.match(runbook, /organization, synthetic staff identity, synthetic client, primary contact, and one synthetic project/i);
  assert.match(runbook, /does not create a proposal, contract, invoice, payment link, payment, email, or provider call/i);
  assert.match(runbook, /Cameron.*action-time approval/i);
  assert.match(runbook, /Stripe and Mailgun credentials are not required to prepare the workspace/i);
  assert.match(status, /dry-run-first synthetic workspace bootstrap/i);
  assert.match(status, /not been run against a named sandbox/i);
});
