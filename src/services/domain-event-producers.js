// Producers for the client-to-payment journey (#412, docs/event-outbox.md).
//
// Each helper builds a catalog payload (ids and non-sensitive fields only) and
// records it with recordDomainEvent. Like recordDomainEvent, each MUST be
// called with the interactive transaction client of the business write, after
// that write succeeded, and its errors must fail the transaction.
//
// Idempotency keys name the business fact, so recording the same fact twice
// returns the first event instead of a second one:
//   invoice.paid       invoice.paid:<invoiceId>:<paymentId>
//   proposal.approved  proposal.approved:<proposalId>
//   contract.signed    contract.signed:<contractId>
import { getRequestOrganizationId } from '../utils/request-context.js';
import { recordDomainEvent, resolveClientOrganizationId } from './domain-event.service.js';

function isoDate(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function upperCurrency(value) {
  return String(value || 'USD').toUpperCase();
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
 *   paymentId: string, method: string, source: 'manual' | 'stripe_checkout', paidAt: Date,
 *   correlationId?: string | null, causationId?: string | null,
 * }} input
 */
export async function recordInvoicePaid(tx, input) {
  const { invoice, paymentId } = input;
  return recordDomainEvent(tx, {
    type: 'invoice.paid',
    organizationId: await owningOrganization(tx, input.organizationId, invoice.clientId),
    aggregateId: invoice.id,
    idempotencyKey: `invoice.paid:${invoice.id}:${paymentId}`,
    correlationId: input.correlationId,
    causationId: input.causationId,
    payload: {
      invoiceId: invoice.id,
      clientId: invoice.clientId,
      paymentId,
      total: invoice.total,
      currency: upperCurrency(invoice.currency),
      method: input.method,
      source: input.source,
      paidAt: isoDate(input.paidAt),
    },
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
  return recordDomainEvent(tx, {
    type: 'proposal.approved',
    organizationId: await owningOrganization(tx, input.organizationId, proposal.clientId),
    aggregateId: proposal.id,
    idempotencyKey: `proposal.approved:${proposal.id}`,
    correlationId: input.correlationId,
    payload: {
      proposalId: proposal.id,
      clientId: proposal.clientId,
      projectId: proposal.projectId ?? null,
      total: proposal.total,
      via: input.via,
      approvedAt: isoDate(input.approvedAt),
    },
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
  return recordDomainEvent(tx, {
    type: 'contract.signed',
    organizationId: await owningOrganization(tx, input.organizationId, contract.clientId),
    aggregateId: contract.id,
    idempotencyKey: `contract.signed:${contract.id}`,
    correlationId: input.correlationId,
    payload: {
      contractId: contract.id,
      clientId: contract.clientId,
      proposalId: contract.proposalId ?? null,
      signingMethod: input.signingMethod,
      documentHash: input.documentHash,
      via: input.via,
      signedAt: isoDate(input.signedAt),
    },
  });
}
