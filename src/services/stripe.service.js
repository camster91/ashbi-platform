// Stripe integration service for payment links and webhooks
import crypto from 'crypto';
import Stripe from 'stripe';
import env from '../config/env.js';
import { recordAuditEvent } from './audit-event.service.js';
import { sendOperationalAlert } from '../observability/alerts.js';
import defaultLogger from '../utils/logger.js';
import { withInvoiceBalance } from '../utils/invoice-balance.js';
import { applyInvoicePayment, claimPayableInvoice, InvoiceOverpaymentError, PAYABLE_INVOICE_STATUSES } from './invoice-settlement.js';

let stripe = null;

// Only open invoices (SENT, VIEWED or OVERDUE) may be settled by a Checkout
// completion: the same set that takes manual payments.
export const SETTLEABLE_INVOICE_STATUSES = PAYABLE_INVOICE_STATUSES;

function getStripe() {
  if (!stripe && env.stripeSecretKey) {
    stripe = new Stripe(env.stripeSecretKey);
  }
  return stripe;
}

export async function createPaymentLink(invoice) {
  const stripeClient = getStripe();
  if (!stripeClient) return null;

  return createPaymentLinkWithClient(invoice, stripeClient);
}

// Reuse an open session only while it has at least this long left, so a
// client is never redirected to a Checkout page that expires mid-payment.
const CHECKOUT_REUSE_MARGIN_MS = 5 * 60 * 1000;

// Checkout charges what is still owed: the balance after recorded (partial)
// payments when the caller loaded it (withInvoiceBalance), else the total.
export function checkoutAmountMinor(invoice) {
  const amount = invoice.balanceDue ?? invoice.total;
  return Math.round(Number(amount || 0) * 100);
}

export function checkoutCurrency(invoice) {
  return (invoice.currency || 'CAD').toLowerCase();
}

/**
 * Stripe idempotency key for one Checkout creation request.
 *
 * Stripe caches a key for 24h and rejects (or replays) any later request that
 * reuses it. A single per-invoice key therefore broke every legitimate new
 * session: an edited total, a rotated public link, or a session that expired
 * inside that window. The key now covers everything that makes the request
 * distinct — the attempt counter (bumped after each stored session), the
 * amount/currency, and a digest of the remaining request parameters — while
 * rapid duplicate retries of the *same* request still share one key and so
 * cannot create two sessions.
 */
export function checkoutIdempotencyKey(invoice, params) {
  const attempt = Number.isInteger(invoice.stripeCheckoutAttempt) ? invoice.stripeCheckoutAttempt : 0;
  const digest = crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 16);
  return `ashbi:invoice:${invoice.id}:checkout:${attempt}:${params.currency}:${params.amountMinor}:${digest}`;
}

/**
 * Return the stored Checkout URL when it is still safe to hand out: same
 * amount and currency as the invoice now has, and not expired (or about to).
 */
export function reusableCheckoutLink(invoice, now = new Date()) {
  if (!invoice.stripePaymentLink || !invoice.stripeCheckoutSessionId) return null;
  if (invoice.stripeCheckoutAmountMinor !== checkoutAmountMinor(invoice)) return null;
  if ((invoice.stripeCheckoutCurrency || '').toLowerCase() !== checkoutCurrency(invoice)) return null;
  if (!invoice.stripeCheckoutExpiresAt) return null;
  if (new Date(invoice.stripeCheckoutExpiresAt).getTime() - now.getTime() <= CHECKOUT_REUSE_MARGIN_MS) return null;
  return invoice.stripePaymentLink;
}

export async function createPaymentLinkWithClient(invoice, stripeClient) {
  const currency = checkoutCurrency(invoice);
  const amountMinor = checkoutAmountMinor(invoice);
  const description = invoice.notes || `Payment for invoice ${invoice.invoiceNumber}`;
  const successUrl = `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=success`;
  const cancelUrl = `${env.appUrl}/portal/invoice/${invoice.viewToken}?payment=cancelled`;
  const idempotencyKey = checkoutIdempotencyKey(invoice, {
    currency, amountMinor, invoiceNumber: invoice.invoiceNumber, description, successUrl, cancelUrl,
  });

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{
      price_data: {
        currency,
        product_data: {
          name: `Invoice ${invoice.invoiceNumber}`,
          description,
        },
        unit_amount: amountMinor,
      },
      quantity: 1,
    }],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: invoice.id,
    metadata: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      currency: currency.toUpperCase(),
      amountMinor: String(amountMinor),
    },
  }, { idempotencyKey });

  return {
    paymentLink: session.url,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
    amountMinor,
    currency,
    expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : null,
    idempotencyKey,
  };
}

/**
 * Fields to persist on the invoice after a session was created. Bumping the
 * attempt counter here is what lets the *next* creation (after expiry or an
 * edit) use a fresh idempotency key.
 */
export function checkoutPersistenceData(invoice, result) {
  const attempt = Number.isInteger(invoice.stripeCheckoutAttempt) ? invoice.stripeCheckoutAttempt : 0;
  return {
    stripePaymentLink: result.paymentLink,
    stripeCheckoutSessionId: result.checkoutSessionId,
    stripePaymentIntentId: result.paymentIntentId,
    stripeCheckoutAmountMinor: result.amountMinor,
    stripeCheckoutCurrency: result.currency,
    stripeCheckoutExpiresAt: result.expiresAt,
    stripeCheckoutAttempt: attempt + 1,
  };
}

/** The invoice cannot take a Checkout payment (settled, voided, nothing owed). */
export class CheckoutNotPayableError extends Error {
  constructor(message = 'Invoice is not awaiting payment') {
    super(message);
    this.name = 'CheckoutNotPayableError';
    this.code = 'INVOICE_NOT_PAYABLE';
    this.statusCode = 409;
  }
}

const CHECKOUT_STORE_ATTEMPTS = 3;

/**
 * Reuse the invoice's open Checkout session when it still matches, otherwise
 * create a new one and persist it. Returns null when Stripe is not configured.
 *
 * The session is priced from the balance read here. It is stored with a
 * compare-and-set on stripeCheckoutAttempt, which every recorded payment
 * bumps (src/services/invoice-settlement.js): if a payment landed after the
 * read, the store loses, the new session is expired at Stripe and the
 * balance is read again. A concurrent request that stored the same session
 * (same idempotency key) is not a loss.
 */
export async function ensureCheckoutSession(prisma, input, { stripeClient = getStripe(), now = new Date(), expireSession = expireCheckoutSession } = {}) {
  let invoice = input.balanceDue === undefined ? await withInvoiceBalance(prisma, input) : input;
  for (let round = 0; round < CHECKOUT_STORE_ATTEMPTS; round += 1) {
    if (!invoice || !SETTLEABLE_INVOICE_STATUSES.includes(invoice.status)) throw new CheckoutNotPayableError();
    if (!(invoice.balanceDue > 0)) throw new CheckoutNotPayableError('Invoice has no balance due');
    const reusable = reusableCheckoutLink(invoice, now);
    if (reusable) return { paymentLink: reusable, reused: true };
    if (!stripeClient) return null;

    const result = await createPaymentLinkWithClient(invoice, stripeClient);
    const data = checkoutPersistenceData(invoice, result);
    const attempt = Number.isInteger(invoice.stripeCheckoutAttempt) ? invoice.stripeCheckoutAttempt : 0;
    const stored = await prisma.invoice.updateMany({
      where: { id: invoice.id, status: { in: [...SETTLEABLE_INVOICE_STATUSES] }, stripeCheckoutAttempt: attempt },
      data,
    });
    if (stored.count === 1) return { paymentLink: result.paymentLink, reused: false, data };

    const fresh = await prisma.invoice.findUnique({ where: { id: invoice.id } });
    if (fresh?.stripeCheckoutSessionId === result.checkoutSessionId) {
      return { paymentLink: result.paymentLink, reused: false, data };
    }
    // Priced from a stale balance (or the invoice was settled meanwhile).
    await expireSession(result.checkoutSessionId, { stripeClient });
    invoice = fresh ? await withInvoiceBalance(prisma, fresh) : null;
  }
  throw new CheckoutNotPayableError('Invoice changed while the payment link was created; try again');
}

export async function handleWebhook(payload, signature) {
  const stripeClient = getStripe();
  if (!stripeClient) throw new Error('Stripe not configured');

  const webhookSecret = env.stripeWebhookSecret;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  const event = stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
  return event;
}

/**
 * A verified checkout that must not settle the invoice: the session does not
 * match it (`CHECKOUT_MISMATCH`), it was already settled by another payment
 * (`INVOICE_ALREADY_PAID`), or the invoice was voided before the customer
 * paid (`INVOICE_VOID` — never flipped back to PAID), or it charged more
 * than the invoice still owes after a payment recorded since the session was
 * created (`CHECKOUT_BALANCE_CHANGED`). Retrying the delivery cannot help.
 */
export class StripeCheckoutRejectedError extends Error {
  /** @param {string} message @param {'CHECKOUT_MISMATCH' | 'INVOICE_ALREADY_PAID' | 'INVOICE_VOID' | 'CHECKOUT_BALANCE_CHANGED'} code */
  constructor(message, code = 'CHECKOUT_MISMATCH') {
    super(message);
    this.name = 'StripeCheckoutRejectedError';
    this.code = code;
  }
}

/**
 * Settle an invoice from a verified checkout.session.completed event. The
 * invoice transition, the payment row and the invoice.paid domain event
 * (docs/event-outbox.md) commit together or not at all.
 * @param {any} prisma
 * @param {any} event Verified Stripe event
 * @param {{ correlationId?: string | null }} [options] Request id of the webhook delivery
 */
export async function recordCompletedCheckout(prisma, event, { correlationId = null } = {}) {
  const session = event.data.object;
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) throw new StripeCheckoutRejectedError('Stripe invoice metadata is missing');
  const transactionId = session.payment_intent || session.id;

  try {
    return await prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new StripeCheckoutRejectedError('Stripe invoice metadata is invalid');

      const expectedCurrency = (invoice.currency || 'CAD').toLowerCase();
      if (session.payment_status !== 'paid') throw new StripeCheckoutRejectedError('Stripe session is not paid');
      const prior = await tx.invoicePayment.findUnique({ where: { transactionId, method: 'STRIPE' } });
      if (prior?.invoiceId === invoiceId) return { duplicate: true, invoiceId };
      if (session.currency?.toLowerCase() !== expectedCurrency) throw new StripeCheckoutRejectedError('Stripe currency does not match invoice');
      if (session.metadata?.invoiceNumber !== invoice.invoiceNumber) throw new StripeCheckoutRejectedError('Stripe invoice number does not match');
      if (!Number.isInteger(session.amount_total) || session.amount_total <= 0) {
        throw new StripeCheckoutRejectedError('Stripe paid amount does not match invoice');
      }

      // Only an open invoice takes the payment: a VOID (or DRAFT) invoice is
      // never flipped to PAID by a stale Checkout session, and a PAID one is
      // not paid twice. The claim locks the row (src/services/invoice-settlement.js).
      const current = await claimPayableInvoice(tx, invoiceId);
      // The claim waits for a concurrent delivery of this same event; once it
      // returns, that delivery's payment is committed and visible here (a new
      // statement under READ COMMITTED). A replay is a duplicate, never an
      // "already paid" alert, whether the invoice is now PAID or still open.
      const replayed = await tx.invoicePayment.findUnique({ where: { transactionId, method: 'STRIPE' } });
      if (replayed?.invoiceId === invoiceId) return { duplicate: true, invoiceId };
      if (!current) {
        const status = (await tx.invoice.findUnique({ where: { id: invoiceId }, select: { status: true } }))?.status;
        if (status === 'VOID') throw new StripeCheckoutRejectedError('Invoice was voided before the payment completed', 'INVOICE_VOID');
        if (status === 'PAID') throw new StripeCheckoutRejectedError('Invoice was already paid by another transaction', 'INVOICE_ALREADY_PAID');
        throw new StripeCheckoutRejectedError('Invoice is not awaiting payment');
      }

      // The charge is recorded against the balance as it is now. A session
      // priced before a manual payment may be smaller than the balance (a
      // partial payment, recorded) or larger (refused and alerted: the
      // customer paid more than is owed and staff must refund the excess).
      const paidAt = new Date(event.created * 1000);
      try {
        const result = await applyInvoicePayment(tx, {
          invoice: current,
          amount: session.amount_total / 100,
          method: 'STRIPE',
          paidAt,
          invoiceFields: { ...CLEARED_CHECKOUT_FIELDS, stripePaymentIntentId: transactionId },
          paymentFields: { transactionId, notes: `Paid via Stripe Checkout event ${event.id}` },
          source: 'stripe_checkout',
          correlationId,
          causationId: typeof event.id === 'string' ? `stripe:${event.id}` : null,
        });
        if (result.fullyPaid) {
          await tx.invoice.update({ where: { id: invoiceId }, data: { stripeCheckoutSessionId: session.id } });
        }
        return { duplicate: false, invoiceId, fullyPaid: result.fullyPaid };
      } catch (error) {
        if (error instanceof InvoiceOverpaymentError) {
          throw new StripeCheckoutRejectedError('Stripe paid more than the invoice balance', 'CHECKOUT_BALANCE_CHANGED');
        }
        throw error;
      }
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      const prior = await prisma.invoicePayment.findUnique({ where: { transactionId, method: 'STRIPE' } });
      if (prior?.invoiceId === invoiceId) return { duplicate: true, invoiceId };
    }
    throw err;
  }
}

/**
 * Classify why a verified checkout.session.completed delivery was not
 * recorded, log it with a distinct code, alert where a human must act, and
 * return the HTTP answer for Stripe.
 *
 * - CHECKOUT_MISMATCH (200, not recorded): the session does not match the
 *   invoice. Retrying cannot help, so the delivery is acknowledged (Stripe
 *   retries every non-2xx answer).
 * - INVOICE_ALREADY_PAID (200, not recorded, alerted once): the customer paid
 *   an invoice another payment already settled; a refund decision is needed.
 * - INVOICE_VOID (200, not recorded, alerted once): the customer paid an
 *   invoice voided after its Checkout session was created; the invoice stays
 *   VOID and staff decide on a refund or re-issue.
 * - DOMAIN_EVENT_INVALID (500, alerted): the outbox event was rejected, so the
 *   payment transaction rolled back. Producers normalize data, so this is a
 *   code defect; Stripe keeps retrying the delivery until it is fixed.
 * - CHECKOUT_RECORDING_FAILED (500): anything else, e.g. the database was
 *   unavailable. Nothing was committed and Stripe retries the delivery.
 *
 * @param {any} err
 * @param {{ event?: any, route?: string, log?: { warn: Function, error: Function }, alert?: typeof sendOperationalAlert }} [context]
 * @returns {{ statusCode: number, code: string, error: string, acknowledged: boolean }}
 */
export function handleCheckoutFailure(err, { event, route, log = defaultLogger, alert = sendOperationalAlert } = {}) {
  const invoiceId = event?.data?.object?.metadata?.invoiceId ?? null;
  const fields = { stripeEventId: event?.id ?? null, invoiceId, errorName: err?.name, errorCode: err?.code };
  let result;
  let alertEvent = null;
  if (err instanceof StripeCheckoutRejectedError && err.code === 'INVOICE_ALREADY_PAID') {
    result = { statusCode: 200, acknowledged: true, code: err.code, error: 'Invoice was already paid by another transaction' };
    alertEvent = 'stripe_checkout_invoice_already_paid';
  } else if (err instanceof StripeCheckoutRejectedError && err.code === 'INVOICE_VOID') {
    // The customer paid a voided invoice (unapplied money): acknowledged so
    // Stripe stops retrying, alerted so staff refund or re-issue.
    result = { statusCode: 200, acknowledged: true, code: err.code, error: 'Invoice was voided before the payment completed' };
    alertEvent = 'stripe_checkout_invoice_void';
  } else if (err instanceof StripeCheckoutRejectedError && err.code === 'CHECKOUT_BALANCE_CHANGED') {
    // A session priced before a later payment charged more than is owed now:
    // nothing is recorded, and staff refund or apply the money.
    result = { statusCode: 200, acknowledged: true, code: err.code, error: 'Stripe payment exceeds the invoice balance' };
    alertEvent = 'stripe_checkout_balance_changed';
  } else if (err instanceof StripeCheckoutRejectedError) {
    result = { statusCode: 200, acknowledged: true, code: 'CHECKOUT_MISMATCH', error: 'Stripe payment did not match an invoice' };
  } else if (err?.code === 'DOMAIN_EVENT_INVALID' || err?.code === 'DOMAIN_EVENT_IDEMPOTENCY_CONFLICT') {
    result = { statusCode: 500, acknowledged: false, code: 'DOMAIN_EVENT_INVALID', error: 'Stripe payment could not be recorded' };
    alertEvent = 'domain_event_invalid';
  } else {
    result = { statusCode: 500, acknowledged: false, code: 'CHECKOUT_RECORDING_FAILED', error: 'Stripe payment could not be recorded' };
  }
  const logFn = result.statusCode >= 500 || alertEvent ? log.error : log.warn;
  logFn.call(log, { ...fields, code: result.code }, 'Stripe checkout not recorded');
  if (alertEvent) {
    Promise.resolve()
      .then(() => alert({ event: alertEvent, severity: 'error', service: 'api', statusCode: result.statusCode, route }))
      .catch((alertError) => log.error({ errorName: alertError?.name }, 'Operational alert delivery failed'));
  }
  return result;
}

/**
 * Audit a newly settled Checkout (not a replayed delivery). Webhooks carry no
 * tenant context, so the owner is resolved from the invoice. Never throws.
 * @param {any} prisma
 * @param {any} request Fastify request (correlation id + network prefix)
 * @param {any} event Verified Stripe event
 * @param {{ duplicate: boolean, invoiceId: string, fullyPaid?: boolean } | undefined} result
 */
export async function recordCheckoutAuditEvents(prisma, request, event, result) {
  if (!result || result.duplicate) return;
  const session = event?.data?.object || {};
  const transactionId = session.payment_intent || session.id;
  let payment = null;
  try {
    payment = await prisma.invoicePayment.findUnique({
      where: { transactionId, method: 'STRIPE' },
      select: { id: true, amount: true },
    });
  } catch {
    payment = null;
  }
  const shared = {
    ownerInvoiceId: result.invoiceId,
    actorType: 'WEBHOOK',
    actorUserId: null,
    requestId: request?.id ?? null,
    ip: null,
  };
  // A charge that leaves a balance (stale, smaller session) is a payment,
  // not a settlement.
  if (result.fullyPaid !== false) {
    await recordAuditEvent(prisma, {
      ...shared,
      action: 'invoice.paid',
      entityId: result.invoiceId,
      metadata: { toStatus: 'PAID', method: 'STRIPE', stripeEventId: event?.id, currency: session.currency },
    });
  }
  await recordAuditEvent(prisma, {
    ...shared,
    action: 'payment.recorded',
    entityId: payment?.id ?? null,
    metadata: {
      invoiceId: result.invoiceId,
      amount: payment?.amount,
      method: 'STRIPE',
      source: 'stripe_checkout',
      stripeEventId: event?.id,
      currency: session.currency,
    },
  });
}

// Refusals where the customer's money arrived but was not applied: staff
// must refund or re-apply it, so each one is kept in the audit log as well
// as alerted (docs/invoicing.md, "Refused Stripe charges").
export const REFUSED_CHARGE_CODES = Object.freeze(['CHECKOUT_BALANCE_CHANGED', 'INVOICE_ALREADY_PAID', 'INVOICE_VOID']);

/**
 * Record a refused Checkout charge as a `payment.refused` audit event on the
 * invoice (tenant resolved from the invoice). Never throws.
 * @param {any} prisma
 * @param {any} request Fastify request (correlation id)
 * @param {any} event Verified Stripe event
 * @param {{ code: string }} failure handleCheckoutFailure's answer
 */
export async function recordRefusedCheckout(prisma, request, event, failure) {
  if (!REFUSED_CHARGE_CODES.includes(failure?.code)) return;
  const session = event?.data?.object || {};
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return;
  await recordAuditEvent(prisma, {
    ownerInvoiceId: invoiceId,
    actorType: 'WEBHOOK',
    actorUserId: null,
    requestId: request?.id ?? null,
    ip: null,
    action: 'payment.refused',
    entityId: invoiceId,
    metadata: {
      code: failure.code,
      amount: Number.isFinite(session.amount_total) ? session.amount_total / 100 : null,
      currency: session.currency,
      stripeEventId: event?.id,
      transactionId: session.payment_intent || session.id,
    },
  });
}

// Fields that forget a stored Checkout session so the next payment request
// creates a fresh one (the attempt counter is deliberately kept).
export const CLEARED_CHECKOUT_FIELDS = Object.freeze({
  stripePaymentLink: null,
  stripeCheckoutSessionId: null,
  stripeCheckoutAmountMinor: null,
  stripeCheckoutCurrency: null,
  stripeCheckoutExpiresAt: null,
});

/**
 * Expire a stored Checkout session so it can no longer be paid (used when an
 * invoice is voided or its currency is rewritten). Best-effort: returns false
 * and logs when Stripe is unavailable; never throws.
 * @param {string | null | undefined} sessionId
 * @param {{ stripeClient?: any, log?: { warn: Function } }} [options]
 */
export async function expireCheckoutSession(sessionId, { stripeClient = getStripe(), log = defaultLogger } = {}) {
  if (!sessionId || !stripeClient) return false;
  try {
    await stripeClient.checkout.sessions.expire(sessionId);
    return true;
  } catch (err) {
    // Already expired/completed sessions are rejected by Stripe; completion
    // is still refused for a VOID invoice by recordCompletedCheckout.
    log.warn({ errorName: err?.name, errorCode: err?.code }, 'Stripe Checkout session could not be expired');
    return false;
  }
}

export async function clearExpiredCheckout(prisma, session) {
  const invoiceId = session.metadata?.invoiceId;
  if (!invoiceId) return false;
  await prisma.invoice.updateMany({
    where: { id: invoiceId, stripeCheckoutSessionId: session.id, status: { not: 'PAID' } },
    data: { ...CLEARED_CHECKOUT_FIELDS },
  });
  return true;
}
