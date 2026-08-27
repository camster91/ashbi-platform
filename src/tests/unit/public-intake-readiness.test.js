import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  assessPublicIntakeEnvironment,
  inspectPublicIntakeTarget,
} from '../../services/public-intake-readiness.service.js';

const safeEnvironment = {
  ASHBI_SANDBOX: 'true',
  ASHBI_SANDBOX_ENVIRONMENT_ID: 'ashbi-intake-sandbox-01',
  APP_URL: 'https://sandbox-hub.ashbi.ca',
  DATABASE_URL: 'postgresql://ashbi:private-password@db.internal:5432/ashbi_intake_sandbox',
  PUBLIC_INTAKE_ORGANIZATION_ID: 'org-private-identifier',
  PUBLIC_INTAKE_OWNER_USER_ID: 'owner-private-identifier',
  PUBLIC_INTAKE_PRIVACY_VERSION: '2026-08-26',
  PUBLIC_INTAKE_ALLOWED_ORIGINS: 'https://sandbox.ashbi.ca',
};

test('public intake environment passes only an explicit non-production target without exposing values', () => {
  const report = assessPublicIntakeEnvironment(safeEnvironment);
  const serialized = JSON.stringify(report);

  assert.equal(report.ready, true);
  assert.equal(report.checks.every((check) => check.ok), true);
  assert.deepEqual(report.checks.map((check) => check.id), [
    'sandbox-flag',
    'environment-id',
    'target-url',
    'database-target',
    'organization-configured',
    'owner-configured',
    'privacy-version',
    'review-origin',
  ]);
  assert.doesNotMatch(serialized, /private-password|org-private-identifier|owner-private-identifier|sandbox\.ashbi\.ca/);
});

test('sandbox readiness rejects an origin allowlist that also contains a production surface', () => {
  const report = assessPublicIntakeEnvironment({
    ...safeEnvironment,
    PUBLIC_INTAKE_ALLOWED_ORIGINS: 'https://sandbox.ashbi.ca,https://ashbi.ca',
  });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === 'review-origin').ok, false);
});

test('sandbox labels require explicit tokens instead of incidental test letters', () => {
  const report = assessPublicIntakeEnvironment({
    ...safeEnvironment,
    ASHBI_SANDBOX_ENVIRONMENT_ID: 'contest-environment',
    DATABASE_URL: 'postgresql://ashbi:redacted@db.internal:5432/contest_data',
  });

  assert.equal(report.ready, false);
  assert.equal(report.checks.find((check) => check.id === 'environment-id').ok, false);
  assert.equal(report.checks.find((check) => check.id === 'database-target').ok, false);
});

test('public intake target is ready only with finished migrations and a matching active staff owner', async () => {
  const calls = [];
  const prisma = {
    $queryRaw: async () => {
      calls.push('migrations');
      return [
        { migration_name: '20260826173000_public_client_acquisition_intake', finished_at: new Date(), rolled_back_at: null },
        { migration_name: '20260826234500_lead_pipeline_promotion', finished_at: new Date(), rolled_back_at: null },
        { migration_name: '20260827013000_lead_follow_up_control', finished_at: new Date(), rolled_back_at: null },
      ];
    },
    organization: {
      findUnique: async ({ where, select }) => {
        calls.push({ organization: { where, select } });
        return { id: safeEnvironment.PUBLIC_INTAKE_ORGANIZATION_ID };
      },
    },
    user: {
      findFirst: async ({ where, select }) => {
        calls.push({ owner: { where, select } });
        return { id: safeEnvironment.PUBLIC_INTAKE_OWNER_USER_ID };
      },
    },
  };

  const report = await inspectPublicIntakeTarget({ environment: safeEnvironment, prisma });

  assert.equal(report.ready, true);
  assert.equal(report.inspected, true);
  assert.deepEqual(report.checks.slice(-3).map((check) => check.id), [
    'required-migrations',
    'organization-exists',
    'owner-active-staff',
  ]);
  assert.deepEqual(calls[1].organization.where, { id: safeEnvironment.PUBLIC_INTAKE_ORGANIZATION_ID });
  assert.deepEqual(calls[2].owner.where, {
    id: safeEnvironment.PUBLIC_INTAKE_OWNER_USER_ID,
    organizationId: safeEnvironment.PUBLIC_INTAKE_ORGANIZATION_ID,
    isActive: true,
    role: { in: ['ADMIN', 'TEAM'] },
  });
  assert.doesNotMatch(JSON.stringify(report), /org-private-identifier|owner-private-identifier/);
});

test('readiness command rejects a production-shaped target without connecting or exposing configuration', () => {
  const result = spawnSync(process.execPath, ['scripts/check-public-intake-readiness.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      ASHBI_SANDBOX: 'true',
      ASHBI_SANDBOX_ENVIRONMENT_ID: 'production-live',
      APP_URL: 'https://hub.ashbi.ca',
      DATABASE_URL: 'postgresql://ashbi:do-not-print@production.internal:5432/ashbi_production',
      PUBLIC_INTAKE_ORGANIZATION_ID: 'org-do-not-print',
      PUBLIC_INTAKE_OWNER_USER_ID: 'owner-do-not-print',
      PUBLIC_INTAKE_PRIVACY_VERSION: '2026-08-26',
      PUBLIC_INTAKE_ALLOWED_ORIGINS: 'https://ashbi.ca',
    },
  });
  const packageJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'check-public-intake-readiness.mjs'), 'utf8');

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).inspected, false);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-print/);
  assert.doesNotMatch(script, /\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/);
  assert.match(packageJson, /"check:public-intake-readiness": "node scripts\/check-public-intake-readiness\.mjs"/);
});

test('operating documentation separates readiness inspection from migration and target-test evidence', () => {
  const validation = fs.readFileSync(path.join(process.cwd(), 'docs', 'public-intake-synthetic-validation.md'), 'utf8');
  const productStatus = fs.readFileSync(path.join(process.cwd(), 'docs', 'product-status.md'), 'utf8');

  assert.match(validation, /npm run check:public-intake-readiness/);
  assert.match(validation, /read-only database inspection/i);
  assert.match(validation, /does not apply migrations/i);
  assert.match(validation, /does not prove.*target test/i);
  assert.match(productStatus, /public-intake-readiness/);
});
