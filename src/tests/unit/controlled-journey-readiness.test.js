import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTROLLED_JOURNEY_REQUIRED_MIGRATIONS,
  assessControlledJourneyPreflight,
  inspectControlledJourneyTarget,
} from '../../services/controlledJourneyReadiness.service.js';

function environment() {
  return {
    ASHBI_SANDBOX: 'true',
    ASHBI_SANDBOX_ENVIRONMENT_ID: 'ashbi-sandbox',
    APP_URL: 'https://hub.sandbox.ashbi.test',
    DATABASE_URL: 'postgresql://secret-user:secret-pass@db.sandbox.test/ashbi_sandbox',
    ASHBI_SANDBOX_STAFF_EMAIL: 'staff+sandbox@example.test',
    ASHBI_SANDBOX_CLIENT_EMAIL: 'client+sandbox@example.test',
    ASHBI_SANDBOX_BACKUP_REFERENCE: 'backup-reference-2026-08-27',
    ASHBI_SANDBOX_APPROVAL_REFERENCE: 'approval-reference-2026-08-27',
    STRIPE_SECRET_KEY: 'rk_test_secret-value-must-not-appear',
    STRIPE_WEBHOOK_SECRET: 'whsec_secret-value-must-not-appear',
    MAILGUN_API_KEY: 'mailgun-secret-value-must-not-appear',
    MAILGUN_DOMAIN: 'sandbox.mailgun.test',
    PUBLIC_INTAKE_ORGANIZATION_ID: 'org-sandbox',
    PUBLIC_INTAKE_OWNER_USER_ID: 'owner-sandbox',
  };
}

function input() {
  return {
    organizationId: 'org-sandbox',
    leadId: 'lead-sandbox',
    publicSiteRevision: 'abcdef1',
    hubRevision: 'abcdef2',
    attestedBy: 'Cameron',
    attestationReference: 'journey-run-2026-08-27',
  };
}

function migrationRows({ missing } = {}) {
  return CONTROLLED_JOURNEY_REQUIRED_MIGRATIONS
    .filter(name => name !== missing)
    .map(migration_name => ({
      migration_name,
      finished_at: new Date('2026-08-27T12:00:00.000Z'),
      rolled_back_at: null,
    }));
}

function harness({ missingMigration } = {}) {
  const queries = {};
  const prisma = {
    $queryRaw: async () => migrationRows({ missing: missingMigration }),
    organization: {
      findUnique: async value => { queries.organization = value; return { id: 'org-sandbox' }; },
    },
    user: {
      findFirst: async value => { queries.owner = value; return { id: 'owner-sandbox' }; },
    },
    client: {
      findFirst: async value => { queries.client = value; return { id: 'client-sandbox' }; },
    },
  };
  return { prisma, queries };
}

test('preflight reports configuration gaps without inspecting or exposing configured values', () => {
  const env = environment();
  delete env.PUBLIC_INTAKE_ORGANIZATION_ID;
  const report = assessControlledJourneyPreflight({ environment: env, input: input() });
  assert.equal(report.inspected, false);
  assert.equal(report.inspectable, false);
  assert.equal(report.checks.find(item => item.id === 'public-intake-organization-match').ok, false);
  const serialized = JSON.stringify(report);
  for (const secret of [
    'secret-user', 'secret-pass', env.STRIPE_SECRET_KEY,
    env.STRIPE_WEBHOOK_SECRET, env.MAILGUN_API_KEY,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test('target preflight verifies migrations, exact synthetic identities, and the record chain without writes', async () => {
  const { prisma, queries } = harness();
  let snapshotArgs;
  let buildArgs;
  const report = await inspectControlledJourneyTarget({
    environment: environment(),
    input: input(),
    prisma,
    readSnapshot: async value => { snapshotArgs = value; return { safe: true }; },
    buildEvidence: value => { buildArgs = value; return { complete: true }; },
  });
  assert.equal(report.ready, true);
  assert.equal(report.inspected, true);
  assert.equal(report.checks.every(item => item.ok), true);
  assert.deepEqual(queries.organization.where, { id: 'org-sandbox' });
  assert.deepEqual(queries.owner.where, {
    id: 'owner-sandbox',
    organizationId: 'org-sandbox',
    email: 'staff+sandbox@example.test',
    isActive: true,
    role: { in: ['ADMIN', 'TEAM'] },
  });
  assert.equal(queries.client.where.organizationId, 'org-sandbox');
  assert.equal(snapshotArgs.organizationId, 'org-sandbox');
  assert.equal(snapshotArgs.leadId, 'lead-sandbox');
  assert.equal(buildArgs.sandboxReadiness.checks[0].id, 'record-chain-preflight');
});

test('a missing required migration remains explicit and prevents record-chain inspection', async () => {
  const missing = CONTROLLED_JOURNEY_REQUIRED_MIGRATIONS.at(-1);
  const { prisma } = harness({ missingMigration: missing });
  let snapshotCalled = false;
  const report = await inspectControlledJourneyTarget({
    environment: environment(),
    input: input(),
    prisma,
    readSnapshot: async () => { snapshotCalled = true; },
  });
  assert.equal(report.ready, false);
  assert.equal(snapshotCalled, false);
  const migrationCheck = report.checks.find(item => item.id === 'required-migrations');
  assert.equal(migrationCheck.ok, false);
  assert.deepEqual(migrationCheck.details.missingMigrations, [missing]);
});

test('record-chain failures are reduced to safe reason codes without leaking thrown values', async () => {
  const { prisma } = harness();
  const report = await inspectControlledJourneyTarget({
    environment: environment(),
    input: input(),
    prisma,
    readSnapshot: async () => { throw new Error('Stripe secret sk_test_do-not-print and lead lead-private'); },
  });
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /sk_test_do-not-print|lead-private/);
  const chain = report.checks.find(item => item.id === 'record-chain-ready');
  assert.equal(chain.ok, false);
  assert.equal(chain.details.reasonCode, 'STRIPE_EVIDENCE_INCOMPLETE');
});

test('readiness command is read-only, package-addressable, and emits no input values itself', () => {
  const service = fs.readFileSync('src/services/controlledJourneyReadiness.service.js', 'utf8');
  const script = fs.readFileSync('scripts/check-controlled-journey-readiness.mjs', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(service, /FROM "_prisma_migrations"/);
  assert.doesNotMatch(service, /prisma\.[A-Za-z]+\.(?:create|update|delete|upsert)/);
  assert.doesNotMatch(script, /console\.log\([^)]*(?:organizationId|leadId|DATABASE_URL|SECRET)/);
  assert.doesNotMatch(script, /--confirm/);
  assert.equal(
    packageJson.scripts['check:controlled-journey-readiness'],
    'node scripts/check-controlled-journey-readiness.mjs',
  );
});
