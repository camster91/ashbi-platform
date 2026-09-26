// Transactional outbox: record a domain event (#412, docs/event-outbox.md).
//
// CONTRACT: `recordDomainEvent(tx, ...)` MUST be called with the interactive
// Prisma transaction client of the business write it describes, inside that
// transaction. The event row then commits or rolls back with the business
// change, so there is never an event for a change that did not happen, nor a
// change without its event. Do not call it with a top-level client, and do not
// catch its errors inside the transaction to "keep going": a failed event
// write must fail the business transaction.
//
// Unlike recordAuditEvent (best-effort, never throws), this function throws:
// an unknown type, an invalid payload, a missing tenant or an idempotency key
// reused for a different fact are programming errors and abort the
// transaction.
//
// Ordering: events of one aggregate get contiguous sequence numbers 1, 2, 3...
// assigned under a transaction-scoped advisory lock on the aggregate, so
// concurrent producers are serialized per aggregate (the unique index on
// (organizationId, aggregateType, aggregateId, sequence) is the backstop).
// This relies on PostgreSQL's default READ COMMITTED isolation, which Prisma
// interactive transactions use unless told otherwise. When one transaction
// records events for several aggregates, record them in a consistent order
// (e.g. sorted by aggregate id) to avoid lock-order deadlocks.
import { randomUUID } from 'node:crypto';
import { getRequestId, getRequestOrganizationId } from '../utils/request-context.js';
import { WITH_DELETED } from './soft-delete.service.js';
import {
  DomainEventValidationError,
  getDomainEventSpec,
  validateDomainEventPayload,
} from './domain-event-catalog.js';

const MAX_ID_LENGTH = 191;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const TRACE_ID_FORMAT = /^[A-Za-z0-9_:.@/+-]+$/;

export class DomainEventIdempotencyConflictError extends Error {
  /** @param {string} idempotencyKey */
  constructor(idempotencyKey) {
    super('Idempotency key already used for a different domain event');
    this.name = 'DomainEventIdempotencyConflictError';
    this.code = 'DOMAIN_EVENT_IDEMPOTENCY_CONFLICT';
    this.idempotencyKey = idempotencyKey;
  }
}

// Trace ids are diagnostics, not business data: one that is too long or has
// unexpected characters is dropped (and the next fallback used) rather than
// failing the business transaction.
function traceIdOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  return text.length <= MAX_ID_LENGTH && TRACE_ID_FORMAT.test(text) ? text : null;
}

function requiredId(value, field, max = MAX_ID_LENGTH) {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new DomainEventValidationError(`${field} is required (1-${max} characters)`);
  }
  return value;
}

/** Transaction-scoped advisory lock key for one aggregate's sequence. */
export function aggregateLockKey(organizationId, aggregateType, aggregateId) {
  return `domain_event:${organizationId}:${aggregateType}:${aggregateId}`;
}

/**
 * Resolve the owning organization of a client. For public capability-link and
 * webhook producers, which run without a tenant context. Bypasses soft-delete
 * filtering so a trashed client's documents still record their events.
 * @param {any} tx
 * @param {string} clientId
 * @returns {Promise<string>}
 */
export async function resolveClientOrganizationId(tx, clientId) {
  const reader = typeof tx?.[WITH_DELETED] === 'function' ? tx[WITH_DELETED]() : tx;
  const client = await reader.client.findUnique({ where: { id: clientId }, select: { organizationId: true } });
  if (!client?.organizationId) {
    throw new DomainEventValidationError('Domain event owner could not be resolved');
  }
  return client.organizationId;
}

/**
 * Append a domain event to the outbox inside the caller's transaction.
 *
 * @param {any} tx Interactive transaction client (scoped or raw).
 * @param {{
 *   type: string,
 *   aggregateId: string,
 *   payload: Record<string, unknown>,
 *   idempotencyKey: string,
 *   organizationId?: string | null,
 *   correlationId?: string | null,
 *   causationId?: string | null,
 *   occurredAt?: Date,
 * }} input
 * @returns {Promise<{ event: any, duplicate: boolean }>}
 */
export async function recordDomainEvent(tx, input) {
  if (!tx || typeof tx.$executeRaw !== 'function' || !tx.domainEvent) {
    throw new DomainEventValidationError('recordDomainEvent requires the business transaction client');
  }
  const spec = getDomainEventSpec(input?.type);
  const type = /** @type {string} */ (input.type);
  const payload = validateDomainEventPayload(type, input.payload);

  const contextOrganizationId = getRequestOrganizationId() ?? null;
  const organizationId = requiredId(input.organizationId ?? contextOrganizationId, 'organizationId');
  // Inside a tenant request the scoped client would silently rewrite a
  // foreign organizationId; refuse instead so the lock, sequence and row
  // always agree on the tenant.
  if (contextOrganizationId && organizationId !== contextOrganizationId) {
    throw new DomainEventValidationError('Domain event organization does not match the request tenant');
  }
  const aggregateType = spec.aggregateType;
  const aggregateId = requiredId(input.aggregateId, 'aggregateId');
  const idempotencyKey = requiredId(input.idempotencyKey, 'idempotencyKey', MAX_IDEMPOTENCY_KEY_LENGTH);
  const correlationId = traceIdOrNull(input.correlationId) ?? traceIdOrNull(getRequestId()) ?? randomUUID();
  const causationId = traceIdOrNull(input.causationId);
  const occurredAt = input.occurredAt instanceof Date && !Number.isNaN(input.occurredAt.getTime())
    ? input.occurredAt
    : new Date();

  // Serialize producers of this aggregate until the transaction ends. Under
  // READ COMMITTED every later statement sees rows committed by the previous
  // lock holder, so both the idempotency check and MAX(sequence) are current.
  const lockKey = aggregateLockKey(organizationId, aggregateType, aggregateId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

  const existing = await tx.domainEvent.findFirst({ where: { organizationId, idempotencyKey } });
  if (existing) {
    if (existing.type !== type || existing.aggregateType !== aggregateType || existing.aggregateId !== aggregateId) {
      throw new DomainEventIdempotencyConflictError(idempotencyKey);
    }
    return { event: existing, duplicate: true };
  }

  const last = await tx.domainEvent.aggregate({
    where: { organizationId, aggregateType, aggregateId },
    _max: { sequence: true },
  });
  const sequence = (last?._max?.sequence ?? 0) + 1;

  try {
    const event = await tx.domainEvent.create({
      data: {
        organizationId,
        type,
        schemaVersion: spec.currentVersion,
        aggregateType,
        aggregateId,
        sequence,
        payload,
        correlationId,
        causationId,
        idempotencyKey,
        occurredAt,
      },
    });
    return { event, duplicate: false };
  } catch (err) {
    // The same key on a *different* aggregate is not serialized by the
    // aggregate lock; the unique index turns it into an error, which aborts
    // the transaction (PostgreSQL cannot continue after a failed statement).
    if (err?.code === 'P2002' && /idempotencyKey/.test(`${JSON.stringify(err.meta ?? {})} ${err.message}`)) {
      throw new DomainEventIdempotencyConflictError(idempotencyKey);
    }
    throw err;
  }
}
