import crypto from 'crypto';
import { UNPAID_INVOICE_STATUSES } from './invoice-balance.js';

const DEFAULT_ACCESS_DAYS = 30;

export function createPublicAccessWindow(preferredExpiry) {
  const now = new Date();
  const fallback = new Date(now.getTime() + DEFAULT_ACCESS_DAYS * 24 * 60 * 60 * 1000);
  const requested = preferredExpiry ? new Date(preferredExpiry) : null;

  return {
    token: crypto.randomBytes(32).toString('base64url'),
    expiresAt: requested && requested > now ? requested : fallback,
    revokedAt: null,
  };
}

// Invoices: a link issued on send stays valid while the invoice is open
// (SENT, VIEWED or OVERDUE) regardless of publicAccessExpiresAt, so payment
// reminders sent after the due date always open. Once the invoice is PAID or
// VOID the link keeps working for this many days (to view the receipt), or
// until its recorded expiry if that is later.
export const INVOICE_RECEIPT_GRACE_DAYS = 30;
export const INVOICE_OPEN_STATUSES = UNPAID_INVOICE_STATUSES;
const EXPIRED = { statusCode: 410, error: 'This link has expired' };

export function invoicePublicAccessFailure(invoice, now = new Date()) {
  if (!invoice) return { statusCode: 404, error: 'Document not found' };
  if (invoice.publicAccessRevokedAt) return { statusCode: 410, error: 'This link has been revoked' };
  // Never issued: send (or rotate) sets the access window.
  if (!invoice.publicAccessExpiresAt) return EXPIRED;
  if (INVOICE_OPEN_STATUSES.includes(invoice.status)) return null;
  if (invoice.status === 'PAID' || invoice.status === 'VOID') {
    const closedAt = invoice.status === 'PAID'
      ? (invoice.paidAt || invoice.updatedAt)
      : (invoice.voidedAt || invoice.updatedAt);
    const graceEnds = closedAt ? new Date(new Date(closedAt).getTime() + INVOICE_RECEIPT_GRACE_DAYS * 24 * 60 * 60 * 1000) : null;
    const recorded = new Date(invoice.publicAccessExpiresAt);
    const validUntil = graceEnds && graceEnds > recorded ? graceEnds : recorded;
    return validUntil > now ? null : EXPIRED;
  }
  return EXPIRED;
}

export function publicAccessFailure(document, now = new Date()) {
  if (!document) return { statusCode: 404, error: 'Document not found' };
  if (document.publicAccessRevokedAt) return { statusCode: 410, error: 'This link has been revoked' };
  if (!document.publicAccessExpiresAt || new Date(document.publicAccessExpiresAt) <= now) {
    return { statusCode: 410, error: 'This link has expired' };
  }
  return null;
}
