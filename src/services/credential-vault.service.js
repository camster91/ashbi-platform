import { decrypt, getCiphertextKeyVersion } from '../utils/crypto.js';
import { sendOperationalAlert } from '../observability/alerts.js';

const PURPOSES = new Set([
  'view credential detail',
  'edit credential',
  'copy credential password',
  'display credential password',
  'incident response',
  'deployment',
  'rotation drill',
]);
const OUTCOMES = new Set(['SUCCESS', 'NOT_FOUND', 'DECRYPT_FAILED']);

export function normalizeCredentialPurpose(value) {
  const purpose = typeof value === 'string' ? value.trim() : '';
  if (!PURPOSES.has(purpose)) {
    const error = new Error('A recognized credential access purpose is required');
    error.statusCode = 400;
    error.code = 'CREDENTIAL_PURPOSE_REQUIRED';
    throw error;
  }
  return purpose;
}

export async function recordCredentialAccess(prisma, event) {
  if (!OUTCOMES.has(event.outcome)) throw new Error('Invalid credential audit outcome');
  return prisma.credentialAccessAudit.create({
    data: {
      organizationId: event.organizationId,
      credentialId: event.credentialId,
      actorUserId: event.actorUserId,
      purpose: normalizeCredentialPurpose(event.purpose),
      outcome: event.outcome,
      route: event.route,
      traceId: event.traceId || null,
      keyVersion: event.keyVersion || null,
    },
  });
}

export async function revealCredentialSecret({ prisma, credential, context }) {
  let keyVersion;
  let plaintext;
  try {
    keyVersion = getCiphertextKeyVersion(credential.password);
    plaintext = decrypt(credential.password);
  } catch (error) {
    await recordCredentialAccess(prisma, {
      ...context,
      credentialId: credential.id,
      keyVersion,
      outcome: 'DECRYPT_FAILED',
    });
    sendOperationalAlert({
      event: 'credential_reveal_failed',
      severity: 'critical',
      service: 'api',
      route: context.route,
    }).catch(() => {});
    throw error;
  }
  // The audit write is a disclosure gate: never return plaintext unless the
  // immutable attribution record was committed successfully.
  await recordCredentialAccess(prisma, {
    ...context,
    credentialId: credential.id,
    keyVersion,
    outcome: 'SUCCESS',
  });
  return plaintext;
}

export async function recordMissingCredentialAccess({ prisma, credentialId, context }) {
  await recordCredentialAccess(prisma, { ...context, credentialId, outcome: 'NOT_FOUND' });
  sendOperationalAlert({
    event: 'credential_reveal_not_found',
    severity: 'warning',
    service: 'api',
    route: context.route,
  }).catch(() => {});
}
