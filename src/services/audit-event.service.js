// Append-only audit event log (issue #412). Event catalog and field rules:
// docs/audit-events.md.
//
// `recordAuditEvent` is deliberately best-effort: it never throws into the
// business action that emitted it. A failed write is logged (without the
// metadata payload) so it can be alerted on, but the invoice still sends and
// the password still changes. The database, not this module, guarantees that
// a written event can never be altered or removed.
import { isIP } from 'node:net';
import defaultLogger from '../utils/logger.js';

export const AUDIT_ACTOR_TYPES = Object.freeze(['USER', 'CLIENT', 'SYSTEM', 'WEBHOOK', 'BOT']);
const ACTOR_TYPE_SET = new Set(AUDIT_ACTOR_TYPES);

/**
 * The closed event catalog: each action's entity type and the only metadata
 * fields it may carry. Adding an action or field means adding it here and to
 * docs/audit-events.md. Unknown actions are dropped (and logged) so the log
 * never fills with ad-hoc names nobody can filter on; metadata fields not
 * listed for the action are dropped.
 */
export const AUDIT_EVENT_CATALOG = Object.freeze({
  'invoice.sent': { entityType: 'invoice', metadata: ['fromStatus', 'toStatus', 'deliveryAccepted', 'paymentLinkAttached', 'total', 'currency', 'bulk'] },
  'invoice.paid': { entityType: 'invoice', metadata: ['fromStatus', 'toStatus', 'method', 'bulk', 'total', 'currency', 'stripeEventId'] },
  'payment.recorded': { entityType: 'invoice_payment', metadata: ['invoiceId', 'amount', 'method', 'source', 'bulk', 'currency', 'stripeEventId'] },
  'proposal.approved': { entityType: 'proposal', metadata: ['fromStatus', 'toStatus', 'total', 'via'] },
  'contract.signed': { entityType: 'contract', metadata: ['fromStatus', 'toStatus', 'signingMethod', 'documentHash', 'via'] },
  'user.role_changed': { entityType: 'user', metadata: ['fromRole', 'toRole'] },
  'user.deactivated': { entityType: 'user', metadata: ['fromActive', 'toActive'] },
  'user.reactivated': { entityType: 'user', metadata: ['fromActive', 'toActive'] },
  'auth.login_failed': { entityType: 'user', metadata: ['portal', 'accountActive'] },
  'auth.password_changed': { entityType: 'user', metadata: ['method', 'sessionsRevoked', 'apiKeysRevoked'] },
  'auth.mfa_enabled': { entityType: 'user', metadata: ['recoveryCodesIssued'] },
  'auth.mfa_disabled': { entityType: 'user', metadata: ['method'] },
  'auth.mfa_reset': { entityType: 'user', metadata: ['wasEnabled'] },
  'auth.mfa_recovery_code_used': { entityType: 'user', metadata: ['remaining'] },
  'auth.mfa_failed': { entityType: 'user', metadata: ['reason'] },
  'auth.reauthenticated': { entityType: 'user', metadata: ['method'] },
  'auth.reauth_failed': { entityType: 'user', metadata: ['reason'] },
  'api_key.created': { entityType: 'api_key', metadata: ['ownerUserId', 'expires', 'expiresAt', 'scopes'] },
  'api_key.revoked': { entityType: 'api_key', metadata: ['ownerUserId'] },
  'settings.ai_provider_changed': { entityType: 'settings', metadata: ['fromProvider', 'toProvider', 'fromModel', 'toModel'] },
  'client_portal.document_deleted': { entityType: 'attachment', metadata: ['projectId', 'clientId', 'mimeType', 'size'] },
  'ai.connection_connected': { entityType: 'ai_provider_connection', metadata: ['keyLast4', 'baseUrlHost', 'defaultModel', 'allowedModelCount', 'monthlyBudgetCents', 'replacedStatus'] },
  'ai.connection_validated': { entityType: 'ai_provider_connection', metadata: ['keyLast4', 'baseUrlHost', 'result', 'errorType', 'fromStatus', 'toStatus'] },
  'ai.connection_rotated': { entityType: 'ai_provider_connection', metadata: ['keyLast4', 'previousKeyLast4', 'baseUrlHost'] },
  'ai.connection_revoked': { entityType: 'ai_provider_connection', metadata: ['keyLast4', 'baseUrlHost', 'fromStatus'] },
  'ai.connection_settings_changed': { entityType: 'ai_provider_connection', metadata: ['fromDefaultModel', 'toDefaultModel', 'fromMonthlyBudgetCents', 'toMonthlyBudgetCents', 'allowedModelCount'] },
  'ai.disabled': { entityType: 'organization', metadata: ['scope'] },
  'ai.enabled': { entityType: 'organization', metadata: ['scope'] },
  'ai.budget_alert': { entityType: 'ai_provider_connection', metadata: ['month', 'spentCents', 'budgetCents', 'thresholdPercent'] },
  'ai.budget_exceeded': { entityType: 'ai_provider_connection', metadata: ['month', 'spentCents', 'budgetCents'] },
  'migration_import.applied': { entityType: 'import_run', metadata: ['source', 'created', 'unchanged', 'alreadyPresent', 'channels'] },
  'migration_import.rolled_back': { entityType: 'import_run', metadata: ['source', 'deletedMessages', 'deletedRecords'] },
});

/** action -> entityType, derived from the catalog. */
export const AUDIT_ACTIONS = Object.freeze(Object.fromEntries(
  Object.entries(AUDIT_EVENT_CATALOG).map(([action, spec]) => [action, spec.entityType]),
));

export const AUDIT_ENTITY_TYPES = Object.freeze([...new Set(Object.values(AUDIT_ACTIONS))]);

const MAX_ID_LENGTH = 191;
// Metadata strings are ids, enums, codes, hashes and ISO dates. No spaces are
// allowed, so free text (notes, names, messages) cannot ride in under an
// allowed field name.
export const MAX_METADATA_STRING = 128;
const METADATA_STRING_FORMAT = /^[A-Za-z0-9_.:/@+-]*$/;

function boundedString(value, max = MAX_ID_LENGTH) {
  if (value === undefined || value === null) return null;
  const text = String(value);
  return text.length > 0 ? text.slice(0, max) : null;
}

function expandIpv6(address) {
  const [head, tail = ''] = address.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = address.includes('::') && tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = address.includes('::')
    ? [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts]
    : headParts;
  return parts.map((part) => part.toLowerCase().replace(/^0+(?=.)/, ''));
}

/**
 * Reduce an address to its network prefix (IPv4 /24, IPv6 /48) so events can
 * show "same network" without storing a personal identifier.
 * @param {unknown} ip
 * @returns {string | null}
 */
export function truncateIp(ip) {
  if (typeof ip !== 'string') return null;
  let address = ip.trim();
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) address = mapped[1];
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.');
    return `${a}.${b}.${c}.0/24`;
  }
  if (version === 6) {
    const zoneless = address.split('%')[0];
    const [a, b, c] = expandIpv6(zoneless);
    return `${a}:${b}:${c}::/48`;
  }
  return null;
}

/**
 * Keep only the metadata fields the action's catalog entry allows, with
 * primitive values: finite numbers, booleans, null, dates (as ISO strings) and
 * strings of at most MAX_METADATA_STRING characters in a restricted id/code
 * format. Anything else is dropped, not truncated or masked.
 * @param {unknown} metadata
 * @param {string} action
 * @returns {Record<string, string | number | boolean | null>}
 */
export function sanitizeAuditMetadata(metadata, action) {
  const allowed = AUDIT_EVENT_CATALOG[action]?.metadata;
  if (!allowed || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const source = /** @type {Record<string, unknown>} */ (metadata);
  /** @type {Record<string, string | number | boolean | null>} */
  const clean = {};
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (value === null || typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    else if (value instanceof Date && !Number.isNaN(value.getTime())) clean[key] = value.toISOString();
    else if (typeof value === 'string' && value.length <= MAX_METADATA_STRING && METADATA_STRING_FORMAT.test(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

/** Map an authenticated principal's role to an audit actor type. */
export function actorTypeForRole(role) {
  if (role === 'CLIENT') return 'CLIENT';
  if (role === 'BOT') return 'BOT';
  return 'USER';
}

/**
 * Derive the request-bound audit fields: the Fastify request id is the
 * correlation id that also appears in request logs and error bodies.
 * @param {any} request Fastify request
 * @param {{ actorType?: string, actorUserId?: string | null }} [overrides]
 */
export function auditContextFromRequest(request, overrides = {}) {
  const user = request?.user;
  return {
    organizationId: user?.organizationId ?? null,
    actorUserId: overrides.actorUserId !== undefined ? overrides.actorUserId : (user?.id ?? null),
    actorType: overrides.actorType ?? actorTypeForRole(user?.role),
    requestId: request?.id ?? null,
    ip: request?.ip ?? null,
  };
}

async function resolveOrganizationId(prisma, event) {
  if (event.organizationId) return event.organizationId;
  if (event.ownerClientId) {
    const client = await prisma.client.findUnique({
      where: { id: event.ownerClientId },
      select: { organizationId: true },
    });
    return client?.organizationId ?? null;
  }
  if (event.ownerInvoiceId) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: event.ownerInvoiceId },
      select: { client: { select: { organizationId: true } } },
    });
    return invoice?.client?.organizationId ?? null;
  }
  return null;
}

/**
 * Append one audit event. Never throws; resolves to the created row, or null
 * when the event was rejected or could not be written.
 *
 * @param {any} prisma Prisma client (request-scoped inside tenant routes, so
 *   organizationId is forced to the caller's tenant; raw on public/webhook
 *   routes, where the owner is resolved from `ownerClientId`/`ownerInvoiceId`).
 * @param {{
 *   organizationId?: string | null, ownerClientId?: string | null, ownerInvoiceId?: string | null,
 *   actorUserId?: string | null, actorType: string, action: string,
 *   entityType?: string, entityId?: string | null, requestId?: string | null,
 *   ip?: string | null, metadata?: Record<string, unknown>,
 * }} event
 * @param {{ logger?: { warn: Function, error: Function } }} [options]
 */
export async function recordAuditEvent(prisma, event, { logger = defaultLogger } = {}) {
  const action = event?.action;
  try {
    const entityType = AUDIT_ACTIONS[action];
    if (!entityType) {
      logger.warn({ auditAction: action }, 'Audit event rejected: unknown action');
      return null;
    }
    if (!ACTOR_TYPE_SET.has(event.actorType)) {
      logger.warn({ auditAction: action, actorType: event.actorType }, 'Audit event rejected: unknown actor type');
      return null;
    }
    const organizationId = await resolveOrganizationId(prisma, event);
    if (!organizationId) {
      logger.warn({ auditAction: action }, 'Audit event rejected: no owning organization');
      return null;
    }
    return await prisma.auditEvent.create({
      data: {
        organizationId,
        actorUserId: boundedString(event.actorUserId),
        actorType: event.actorType,
        action,
        entityType: event.entityType ?? entityType,
        entityId: boundedString(event.entityId),
        requestId: boundedString(event.requestId, 100),
        ip: truncateIp(event.ip),
        metadata: sanitizeAuditMetadata(event.metadata, action),
      },
    });
  } catch (err) {
    logger.error({ err: { message: err?.message, code: err?.code }, auditAction: action }, 'Audit event write failed');
    return null;
  }
}

/**
 * Convenience wrapper for route handlers: request context + event fields.
 * @param {any} prisma
 * @param {any} request
 * @param {Parameters<typeof recordAuditEvent>[1]} event
 * @param {Parameters<typeof recordAuditEvent>[2]} [options]
 */
export function recordRequestAuditEvent(prisma, request, event, options) {
  /** @type {Record<string, unknown>} */
  let merged;
  try {
    merged = { ...auditContextFromRequest(request, event) };
  } catch {
    merged = {};
  }
  for (const [field, value] of Object.entries(event || {})) {
    if (value !== undefined) merged[field] = value;
  }
  return recordAuditEvent(prisma, /** @type {any} */ (merged), options);
}
