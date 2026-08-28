import crypto from 'node:crypto';
import { assessSandboxReadiness } from './sandbox-readiness.service.js';

const TARGET_CHECKS = Object.freeze([
  'sandbox-flag',
  'environment-id',
  'target-url',
  'database-target',
]);

function text(value) {
  return String(value ?? '').trim();
}

function check(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function safeApplicationTarget(value) {
  const url = new URL(text(value));
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ''}`;
}

function safeDatabaseTarget(value) {
  const url = new URL(text(value));
  return {
    protocol: url.protocol.toLowerCase(),
    hostname: url.hostname.toLowerCase(),
    port: url.port || null,
    database: url.pathname.replace(/^\/+/, '').toLowerCase(),
  };
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function assessMigrationSandboxTarget({
  environment = {},
  organizationId,
  requireMutationAuthorization = false,
}) {
  const readiness = assessSandboxReadiness(environment);
  const byId = new Map(readiness.checks.map(item => [item.id, item]));
  const configuredOrganizationId = text(environment.ASHBI_SANDBOX_ORGANIZATION_ID);
  const selectedOrganizationId = text(organizationId);
  const checks = TARGET_CHECKS.map(id => byId.get(id));
  checks.push(check(
    'sandbox-organization',
    selectedOrganizationId.length > 0 && configuredOrganizationId === selectedOrganizationId,
    'The selected organization matches the named sandbox organization.',
    'Bind the selected organization to ASHBI_SANDBOX_ORGANIZATION_ID for this sandbox.',
  ));
  if (requireMutationAuthorization) {
    checks.push(byId.get('backup-reference'), byId.get('approval-reference'));
  }

  if (!checks.every(item => item?.ok)) {
    return { ready: false, environmentKind: 'sandbox', targetFingerprint: null, checks };
  }

  let targetFingerprint = null;
  try {
    targetFingerprint = fingerprint({
      environmentId: text(environment.ASHBI_SANDBOX_ENVIRONMENT_ID).toLowerCase(),
      organizationId: selectedOrganizationId,
      application: safeApplicationTarget(environment.APP_URL),
      database: safeDatabaseTarget(environment.DATABASE_URL),
    });
  } catch {
    return {
      ready: false,
      environmentKind: 'sandbox',
      targetFingerprint: null,
      checks: [...checks, check(
        'target-fingerprint',
        false,
        '',
        'The sandbox target could not be fingerprinted safely.',
      )],
    };
  }

  return {
    ready: true,
    environmentKind: 'sandbox',
    targetFingerprint,
    checks: [...checks, check(
      'target-fingerprint',
      true,
      'The redacted sandbox target fingerprint is recorded.',
      '',
    )],
  };
}
