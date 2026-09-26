// Producers for the client-to-payment journey (#412, docs/event-outbox.md).
//
// Each helper builds a catalog payload (ids and non-sensitive fields only) and
// records it with recordDomainEvent. Like recordDomainEvent, each MUST be
// called with the interactive transaction client of the business write, after
// that write succeeded, and its errors must fail the transaction.
//
// The outbox must never stop a valid business write (above all a payment)
// because the stored data is out of shape. So producers NORMALIZE what they
// read from the database before the strict catalog validation sees it: a
// legacy or invalid currency becomes 'XXX' (ISO 4217 "no currency"), a
// non-finite amount becomes 0, an id outside the id format becomes a
// deterministic `invalid-<sha256 prefix>` id, and so on. Every normalized
// field is listed in the payload's `dataIssues`, so consumers can tell and
// operators can repair the source row. Catalog validation stays strict: what
// can still fail it is a programmer error (a wrong literal, a missing field).
//
// Idempotency keys name the business fact, so recording the same fact twice
// returns the first event instead of a second one:
//   invoice.paid       invoice.paid:<invoiceId>:<paymentId>
//   proposal.approved  proposal.approved:<proposalId>
//   contract.signed    contract.signed:<contractId>
import { createHash } from 'node:crypto';
import { getRequestOrganizationId } from '../utils/request-context.js';
import { recordDomainEvent, resolveClientOrganizationId } from './domain-event.service.js';

// Matches the catalog's id, code and currency formats.
const ID_FORMAT = /^[A-Za-z0-9_:.-]+$/;
const MAX_ID_LENGTH = 191;
const CODE_FORMAT = /^[A-Za-z0-9_-]{1,40}$/;
const CURRENCY_FORMAT = /^[A-Z]{3}$/;
const SHA256_FORMAT = /^[a-f0-9]{64}$/;
// Stripe and invoice creation fall back to CAD when an invoice has none.
export const DEFAULT_CURRENCY = 'CAD';
export const UNKNOWN_CURRENCY = 'XXX';

/** Collects normalizations for one payload. */
export class PayloadNormalizer {
  constructor() {
    /** @type {string[]} */
    this.issues = [];
  }

  flag(field) {
    if (!this.issues.includes(field)) this.issues.push(field);
  }

  /** A deterministic id: valid ids pass through, anything else is hashed. */
  id(field, value) {
    if (typeof value === 'string' && value.length <= MAX_ID_LENGTH && ID_FORMAT.test(value)) return value;
    this.flag(field);
    return `invalid-${createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 32)}`;
  }

  nullableId(field, value) {
    return value === null || value === undefined ? null : this.id(field, value);
  }

  amount(field, value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    this.flag(field);
    return 0;
  }

  currency(field, value) {
    if (value === null || value === undefined || value === '') return DEFAULT_CURRENCY;
    const upper = String(value).trim().toUpperCase();
    if (CURRENCY_FORMAT.test(upper)) return upper;
    this.flag(field);
    return UNKNOWN_CURRENCY;
  }

  code(field, value, fallback = 'UNKNOWN') {
    if (typeof value === 'string' && CODE_FORMAT.test(value)) return value;
    this.flag(field);
    return fallback;
  }

  oneOf(field, value, allowed, fallback) {
    if (allowed.includes(value)) return value;
    this.flag(field);
    return fallback;
  }

  sha256(field, value) {
    if (typeof value === 'string' && SHA256_FORMAT.test(value)) return value;
    this.flag(field);
    return createHash('sha256').update(String(value ?? '')).digest('hex');
  }

  /** ISO timestamp; an invalid date falls back to `fallback` (now). */
  date(field, value, fallback = new Date()) {
    const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
    if (value !== null && value !== undefined && !Number.isNaN(date.getTime())) return date.toISOString();
    this.flag(field);
    return fallback.toISOString();
  }

  /** Attach `dataIssues` only when something was normalized. */
  finish(payload) {
    return this.issues.length ? { ...payload, dataIssues: [...this.issues] } : payload;
  }
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** `type:part:part`, hashed deterministically if it would exceed the column limit. */
export function idempotencyKeyFor(type, ...parts) {
  const key = [type, ...parts].join(':');
  if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) return key;
  return `${type}:sha256:${createHash('sha256').update(key).digest('hex')}`;
}

// Tenant routes carry the organization in the request context; public
// capability-link and webhook routes resolve it from the owning client.
async function owningOrganization(tx, organizationId, clientId) {
  return organizationId ?? getRequestOrganizationId() ?? resolveClientOrganizationId(tx, clientId);
}

/**
 * @param {any} tx
 * @param {{
 *   organizationId?: string | null, invoice: { id: string, clientId: string, total: number, currency?: string | null },
 *   paymentId: string, amount: number, method: string, source: 'manual' | 'stripe_checkout', paidAt: Date,
 *   correlationId?: string | null, causationId?: string | null,
 * }} input
 */
export async function recordInvoicePaid(tx, input) {
  const { invoice } = input;
  const n = new PayloadNormalizer();
  const invoiceId = n.id('invoiceId', invoice.id);
  const paymentId = n.id('paymentId', input.paymentId);
  const payload = n.finish({
    invoiceId,
    clientId: n.id('clientId', invoice.clientId),
    paymentId,
    amount: n.amount('amount', input.amount),
    total: n.amount('total', invoice.total),
    currency: n.currency('currency', invoice.currency),
    method: n.code('method', input.method),
    source: input.source,
    paidAt: n.date('paidAt', input.paidAt),
  });
  return recordDomainEvent(tx, {
    type: 'invoice.paid',
    organizationId: await owningOrganization(tx, input.organizationId, invoice.clientId),
    aggregateId: invoiceId,
    idempotencyKey: idempotencyKeyFor('invoice.paid', invoiceId, paymentId),
    correlationId: input.correlationId,
    causationId: input.causationId,
    payload,
  });
}

/**
 * @param {any} tx
 * @param {{
 *   organizationId?: string | null,
 *   proposal: { id: string, clientId: string, projectId?: string | null, total: number },
 *   via: 'portal_link' | 'public_link', approvedAt: Date, correlationId?: string | null,
 * }} input
 */
export async function recordProposalApproved(tx, input) {
  const { proposal } = input;
  const n = new PayloadNormalizer();
  const proposalId = n.id('proposalId', proposal.id);
  const payload = n.finish({
    proposalId,
    clientId: n.id('clientId', proposal.clientId),
    projectId: n.nullableId('projectId', proposal.projectId),
    total: n.amount('total', proposal.total),
    via: input.via,
    approvedAt: n.date('approvedAt', input.approvedAt),
  });
  return recordDomainEvent(tx, {
    type: 'proposal.approved',
    organizationId: await owningOrganization(tx, input.organizationId, proposal.clientId),
    aggregateId: proposalId,
    idempotencyKey: idempotencyKeyFor('proposal.approved', proposalId),
    correlationId: input.correlationId,
    payload,
  });
}

/**
 * @param {any} tx
 * @param {{
 *   organizationId?: string | null,
 *   contract: { id: string, clientId: string, proposalId?: string | null },
 *   signingMethod: 'type' | 'draw', documentHash: string, via: 'portal_link' | 'public_link',
 *   signedAt: Date, correlationId?: string | null,
 * }} input
 */
export async function recordContractSigned(tx, input) {
  const { contract } = input;
  const n = new PayloadNormalizer();
  const contractId = n.id('contractId', contract.id);
  const payload = n.finish({
    contractId,
    clientId: n.id('clientId', contract.clientId),
    proposalId: n.nullableId('proposalId', contract.proposalId),
    signingMethod: n.oneOf('signingMethod', input.signingMethod, ['type', 'draw'], 'type'),
    documentHash: n.sha256('documentHash', input.documentHash),
    via: input.via,
    signedAt: n.date('signedAt', input.signedAt),
  });
  return recordDomainEvent(tx, {
    type: 'contract.signed',
    organizationId: await owningOrganization(tx, input.organizationId, contract.clientId),
    aggregateId: contractId,
    idempotencyKey: idempotencyKeyFor('contract.signed', contractId),
    correlationId: input.correlationId,
    payload,
  });
}
