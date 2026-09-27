// Versioned catalog of domain events (#412, docs/event-outbox.md).
//
// Each event type names the aggregate it belongs to and a Zod schema per
// payload version. `recordDomainEvent` rejects any type not listed here and
// validates the payload against the type's *current* version; older versions
// stay listed so consumers (and replays) can still parse rows written before
// a change.
//
// Payloads carry ids, enums, amounts, hashes and timestamps only. Names,
// email addresses, notes, signatures and free text never go in a payload:
// every schema is `.strict()`, so an unlisted field fails validation instead
// of being stored. Versioning and deprecation rules: docs/event-outbox.md.
import { z } from 'zod';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9_:.-]+$/, 'must be an id');
const isoDateTime = z.string().datetime({ offset: true });
const amount = z.number().finite();
const currency = z.string().regex(/^[A-Z]{3}$/, 'must be an upper-case ISO 4217 code');
const code = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, 'must be a code');
const sha256Hex = z.string().regex(/^[a-f0-9]{64}$/, 'must be a sha256 hex digest');
// Payload fields a producer had to normalize because the stored business
// data was out of shape (e.g. a legacy currency). See
// src/services/domain-event-producers.js and docs/event-outbox.md.
const dataIssues = z.array(z.string().regex(/^[A-Za-z]+$/).max(40)).min(1).max(20).optional();

/**
 * @typedef {{
 *   aggregateType: string,
 *   currentVersion: number,
 *   versions: Record<number, import('zod').ZodTypeAny>,
 *   deprecated?: { since: string, replacedBy?: string },
 * }} DomainEventSpec
 */

/** @type {Readonly<Record<string, DomainEventSpec>>} */
export const DOMAIN_EVENT_CATALOG = Object.freeze({
  'invoice.paid': {
    aggregateType: 'invoice',
    currentVersion: 1,
    versions: {
      1: z.object({
        invoiceId: id,
        clientId: id,
        paymentId: id.nullable(),
        amount,
        total: amount,
        currency,
        method: code,
        source: z.enum(['manual', 'stripe_checkout']),
        paidAt: isoDateTime,
        dataIssues,
      }).strict(),
    },
  },
  'proposal.approved': {
    aggregateType: 'proposal',
    currentVersion: 1,
    versions: {
      1: z.object({
        proposalId: id,
        clientId: id,
        projectId: id.nullable(),
        total: amount,
        via: z.enum(['portal_link', 'public_link']),
        approvedAt: isoDateTime,
        dataIssues,
      }).strict(),
    },
  },
  'contract.signed': {
    aggregateType: 'contract',
    currentVersion: 1,
    versions: {
      1: z.object({
        contractId: id,
        clientId: id,
        proposalId: id.nullable(),
        signingMethod: z.enum(['type', 'draw']),
        documentHash: sha256Hex,
        via: z.enum(['portal_link', 'public_link']),
        signedAt: isoDateTime,
        dataIssues,
      }).strict(),
    },
  },
});

export const DOMAIN_EVENT_TYPES = Object.freeze(Object.keys(DOMAIN_EVENT_CATALOG));
export const DOMAIN_EVENT_AGGREGATE_TYPES = Object.freeze([
  ...new Set(Object.values(DOMAIN_EVENT_CATALOG).map((spec) => spec.aggregateType)),
]);

export class DomainEventValidationError extends Error {
  /**
   * @param {string} message
   * @param {{ type?: string, issues?: Array<{ path: string, message: string }> }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'DomainEventValidationError';
    this.code = 'DOMAIN_EVENT_INVALID';
    this.type = details.type;
    this.issues = details.issues ?? [];
  }
}

/**
 * Look up the catalog entry for a type, or throw for an unknown type.
 * @param {unknown} type
 * @returns {DomainEventSpec}
 */
export function getDomainEventSpec(type) {
  const spec = typeof type === 'string' && Object.prototype.hasOwnProperty.call(DOMAIN_EVENT_CATALOG, type)
    ? DOMAIN_EVENT_CATALOG[type]
    : null;
  if (!spec) throw new DomainEventValidationError(`Unknown domain event type: ${String(type)}`, { type: String(type) });
  return spec;
}

/**
 * Validate a payload against a type's schema version (the current version by
 * default). Returns the parsed payload; throws DomainEventValidationError.
 * The error lists field paths and messages only, never the rejected values.
 *
 * @param {string} type
 * @param {unknown} payload
 * @param {number} [schemaVersion]
 */
export function validateDomainEventPayload(type, payload, schemaVersion) {
  const spec = getDomainEventSpec(type);
  const version = schemaVersion ?? spec.currentVersion;
  const schema = spec.versions[version];
  if (!schema) {
    throw new DomainEventValidationError(`Unknown schema version ${version} for ${type}`, { type });
  }
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    throw new DomainEventValidationError(`Invalid ${type} v${version} payload`, { type, issues });
  }
  return result.data;
}

/**
 * Consumer-side helper: parse a stored event's payload with the schema of the
 * version it was written with.
 * @param {{ type: string, schemaVersion: number, payload: unknown }} event
 */
export function parseDomainEventPayload(event) {
  return validateDomainEventPayload(event.type, event.payload, event.schemaVersion);
}
