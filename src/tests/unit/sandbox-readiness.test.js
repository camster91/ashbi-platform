import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assessSandboxReadiness } from '../../services/sandbox-readiness.service.js';

const validEnvironment = {
  ASHBI_SANDBOX: 'true',
  ASHBI_SANDBOX_ENVIRONMENT_ID: 'ashbi-provider-sandbox-01',
  ASHBI_SANDBOX_STAFF_EMAIL: 'staff+sandbox@ashbi.ca',
  ASHBI_SANDBOX_CLIENT_EMAIL: 'client+sandbox@ashbi.ca',
  ASHBI_SANDBOX_BACKUP_REFERENCE: 'backup-2026-08-27-provider-sandbox',
  ASHBI_SANDBOX_APPROVAL_REFERENCE: 'approval-2026-08-27-provider-validation',
  APP_URL: 'https://sandbox-hub.ashbi.ca',
  DATABASE_URL: 'postgresql://ashbi:redacted@db.internal:5432/ashbi_sandbox',
  STRIPE_SECRET_KEY: 'rk_test_redacted_for_unit_test',
  STRIPE_WEBHOOK_SECRET: 'whsec_redacted_for_unit_test',
  MAILGUN_API_KEY: 'redacted-mailgun-test-key',
  MAILGUN_DOMAIN: 'sandbox123.mailgun.org',
};

test('sandbox preflight passes only an explicitly evidenced non-production provider target', () => {
  const report = assessSandboxReadiness(validEnvironment);

  assert.equal(report.ready, true);
  assert.equal(report.checks.every((check) => check.ok), true);
  assert.deepEqual(report.checks.map((check) => check.id), [
    'sandbox-flag',
    'environment-id',
    'target-url',
    'database-target',
    'synthetic-staff',
    'synthetic-client',
    'backup-reference',
    'approval-reference',
    'stripe-restricted-test-key',
    'stripe-webhook-secret',
    'mailgun-sandbox',
  ]);
});

test('sandbox preflight rejects live Stripe or production Hub configuration without exposing secrets', () => {
  const report = assessSandboxReadiness({
    ...validEnvironment,
    APP_URL: 'https://hub.ashbi.ca',
    DATABASE_URL: 'postgresql://ashbi:super-secret@db.internal:5432/ashbi_production',
    STRIPE_SECRET_KEY: 'sk_live_do_not_expose',
    STRIPE_WEBHOOK_SECRET: 'live-webhook-do-not-expose',
    MAILGUN_DOMAIN: 'ashbi.ca',
    ASHBI_SANDBOX_APPROVAL_REFERENCE: 'pending',
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.ready, false);
  assert.equal(report.checks.filter((check) => !check.ok).length >= 5, true);
  assert.doesNotMatch(serialized, /super-secret|sk_live_do_not_expose|live-webhook-do-not-expose/);
});

test('sandbox readiness command is read-only and exits from the redacted report', () => {
  const script = fs.readFileSync(path.join(process.cwd(), 'scripts', 'check-sandbox-readiness.mjs'), 'utf8');
  const packageJson = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8');

  assert.match(script, /assessSandboxReadiness\(process\.env\)/);
  assert.doesNotMatch(script, /fetch\(|prisma|stripe\.|mailgun\./i);
  assert.match(packageJson, /"check:sandbox-readiness": "node scripts\/check-sandbox-readiness\.mjs"/);
});
