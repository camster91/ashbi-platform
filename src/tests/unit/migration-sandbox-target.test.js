import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { assessMigrationSandboxTarget } from '../../services/migrationSandboxTarget.service.js';

const validEnvironment = {
  ASHBI_SANDBOX: 'true',
  ASHBI_SANDBOX_ENVIRONMENT_ID: 'ashbi-migration-sandbox-01',
  ASHBI_SANDBOX_ORGANIZATION_ID: 'org-sandbox',
  ASHBI_SANDBOX_BACKUP_REFERENCE: 'backup-migration-sandbox-2026-08-28',
  ASHBI_SANDBOX_APPROVAL_REFERENCE: 'Cameron approved sandbox import 2026-08-28T12:00Z',
  APP_URL: 'https://migration-sandbox.ashbi.test',
  DATABASE_URL: 'postgresql://private-user:private-password@db.sandbox.test:5432/ashbi_migration_sandbox?sslmode=require',
};

test('migration target binds a selected organization to one redacted sandbox fingerprint', () => {
  const result = assessMigrationSandboxTarget({ environment: validEnvironment, organizationId: 'org-sandbox' });
  assert.equal(result.ready, true);
  assert.equal(result.environmentKind, 'sandbox');
  assert.match(result.targetFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.checks.every(item => item.ok), true);
  assert.doesNotMatch(JSON.stringify(result), /private-user|private-password|migration-sandbox\.ashbi\.test/);

  const credentialRotation = assessMigrationSandboxTarget({
    environment: {
      ...validEnvironment,
      DATABASE_URL: 'postgresql://rotated-user:rotated-password@db.sandbox.test:5432/ashbi_migration_sandbox?sslmode=verify-full',
    },
    organizationId: 'org-sandbox',
  });
  assert.equal(credentialRotation.targetFingerprint, result.targetFingerprint);
});

test('confirmed migration also requires backup and exact action-time approval evidence', () => {
  const environment = { ...validEnvironment, ASHBI_SANDBOX_BACKUP_REFERENCE: '', ASHBI_SANDBOX_APPROVAL_REFERENCE: '' };
  assert.equal(assessMigrationSandboxTarget({ environment, organizationId: 'org-sandbox' }).ready, true);
  const confirmed = assessMigrationSandboxTarget({
    environment,
    organizationId: 'org-sandbox',
    requireMutationAuthorization: true,
  });
  assert.equal(confirmed.ready, false);
  assert.deepEqual(confirmed.checks.filter(item => !item.ok).map(item => item.id), ['backup-reference', 'approval-reference']);
});

test('migration target rejects a production target or another organization', () => {
  const production = assessMigrationSandboxTarget({
    environment: { ...validEnvironment, APP_URL: 'https://hub.ashbi.ca' },
    organizationId: 'org-sandbox',
  });
  assert.equal(production.ready, false);
  assert.equal(production.targetFingerprint, null);
  assert.equal(production.checks.find(item => item.id === 'target-url').ok, false);

  const otherOrganization = assessMigrationSandboxTarget({ environment: validEnvironment, organizationId: 'org-other' });
  assert.equal(otherOrganization.ready, false);
  assert.equal(otherOrganization.checks.find(item => item.id === 'sandbox-organization').ok, false);
});

test('migration target has a read-only CLI with separate dry-run and confirmation checks', () => {
  const script = readFileSync('scripts/check-migration-sandbox-target.mjs', 'utf8');
  const packageJson = readFileSync('package.json', 'utf8');
  assert.match(script, /assessMigrationSandboxTarget/);
  assert.match(script, /--organization-id/);
  assert.match(script, /process\.argv\.includes\('--confirm'\)/);
  assert.doesNotMatch(script, /Prisma|writeFile|create|update|delete/);
  assert.match(packageJson, /"check:migration-sandbox-target": "node scripts\/check-migration-sandbox-target\.mjs"/);
});
