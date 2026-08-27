import crypto from 'node:crypto';

export const REVENUE_EVIDENCE_COLLECTIONS = Object.freeze([
  'invoices',
  'lineItems',
  'deliveryAttempts',
  'deliveryEvents',
  'payments',
  'refunds',
  'refundEvents',
  'settlementEvents',
  'checkoutAudits',
]);
const NON_STRIPE_SETTLEMENT_METHODS = new Set(['BANK', 'CHECK', 'CASH', 'OTHER']);

function stableJson(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function iso(value) {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function moneyToMinor(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const minor = Math.round(number * 100);
  return Math.abs(number * 100 - minor) < 1e-7 ? minor : null;
}

function copy(record, fields, dateFields = []) {
  return Object.fromEntries(fields.map(field => [
    field,
    dateFields.includes(field) ? iso(record?.[field]) : (record?.[field] ?? null),
  ]));
}

function byId(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

const invoiceSelect = {
  id: true,
  invoiceNumber: true,
  clientId: true,
  projectId: true,
  proposalId: true,
  bonsaiInvoiceId: true,
  status: true,
  currency: true,
  subtotal: true,
  discountAmount: true,
  taxRate: true,
  taxType: true,
  tax: true,
  total: true,
  issueDate: true,
  dueDate: true,
  paidAt: true,
  sentAt: true,
  voidedAt: true,
  createdAt: true,
  updatedAt: true,
  stripeCheckoutAttempt: true,
  emailDeliveryAttempt: true,
  stripeCheckoutReconciliationRequiredAt: true,
  stripeCheckoutReconciliationReason: true,
  paymentMethod: true,
  transactionId: true,
  lineItems: {
    select: {
      id: true, invoiceId: true, description: true, itemType: true, quantity: true,
      unitPrice: true, total: true, position: true,
    },
  },
  deliveryAttempts: {
    select: {
      id: true, invoiceId: true, requestId: true, attemptNumber: true, kind: true,
      status: true, provider: true, providerMessageId: true, failureCode: true,
      acceptedAt: true, failedAt: true, outcomeUnknownAt: true, canceledAt: true,
      providerLifecycleStatus: true, lastProviderEventAt: true,
      recipientServerAcceptedAt: true, temporaryFailureAt: true, permanentFailureAt: true,
      createdAt: true, updatedAt: true,
      events: {
        select: {
          id: true, attemptId: true, invoiceId: true, status: true,
          providerMessageId: true, failureCode: true, providerEventId: true,
          providerEventKey: true, providerOccurredAt: true, occurredAt: true, createdAt: true,
        },
      },
    },
  },
  payments: {
    select: {
      id: true, invoiceId: true, amountMinor: true, currency: true, method: true,
      transactionId: true, paidAt: true, createdAt: true, settlementEvidenceStatus: true,
      stripeChargeId: true, stripeBalanceTransactionId: true, settlementGrossMinor: true,
      providerFeeMinor: true, settlementNetMinor: true, settlementCurrency: true,
      settlementReconciledAt: true, settlementReconciliationReason: true,
      refunds: {
        select: {
          id: true, invoiceId: true, paymentId: true, stripeRefundId: true,
          amountMinor: true, currency: true, status: true, failureReason: true,
          providerCreatedAt: true, lastProviderEventAt: true, lastStripeEventId: true,
          createdAt: true, updatedAt: true,
        },
      },
      settlementEvents: {
        select: {
          id: true, invoiceId: true, paymentId: true, requestId: true, status: true,
          paymentIntentId: true, stripeChargeId: true, stripeBalanceTransactionId: true,
          chargeAmountMinor: true, chargeCurrency: true, settlementGrossMinor: true,
          providerFeeMinor: true, settlementNetMinor: true, settlementCurrency: true,
          reasonCode: true, occurredAt: true, createdAt: true,
        },
      },
    },
  },
  refundEvents: {
    select: {
      id: true, invoiceId: true, refundId: true, stripeRefundId: true,
      stripeEventId: true, eventType: true, paymentIntentId: true, amountMinor: true,
      currency: true, status: true, signedStatus: true, providerEventAt: true, createdAt: true,
    },
  },
  checkoutAudits: {
    select: {
      id: true, invoiceId: true, checkoutSessionId: true, checkoutAttempt: true,
      action: true, outcome: true, providerStatus: true, reasonCode: true,
      actorUserId: true, createdAt: true,
    },
  },
};

export async function createRevenueEvidenceExport({ prisma, organizationId, exportedAt = new Date() }) {
  if (!prisma?.invoice?.findMany || typeof organizationId !== 'string' || !organizationId.trim()) {
    throw new TypeError('A tenant-scoped Prisma client and organization ID are required');
  }
  const exportedAtIso = iso(exportedAt);
  if (!exportedAtIso) throw new TypeError('exportedAt must be a valid date');

  const sourceInvoices = await prisma.invoice.findMany({
    where: { deletedAt: null, client: { organizationId } },
    select: invoiceSelect,
    orderBy: [{ issueDate: 'asc' }, { id: 'asc' }],
  });

  const records = Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [collection, []]));
  for (const invoice of sourceInvoices) {
    records.invoices.push({
      ...copy(invoice, [
        'id', 'invoiceNumber', 'clientId', 'projectId', 'proposalId', 'bonsaiInvoiceId',
        'status', 'currency', 'taxRate', 'taxType', 'stripeCheckoutAttempt',
        'emailDeliveryAttempt', 'stripeCheckoutReconciliationReason', 'paymentMethod',
        'transactionId', 'issueDate', 'dueDate', 'paidAt', 'sentAt', 'voidedAt',
        'createdAt', 'updatedAt', 'stripeCheckoutReconciliationRequiredAt',
      ], [
        'issueDate', 'dueDate', 'paidAt', 'sentAt', 'voidedAt', 'createdAt', 'updatedAt',
        'stripeCheckoutReconciliationRequiredAt',
      ]),
      subtotalMinor: moneyToMinor(invoice.subtotal),
      discountAmountMinor: moneyToMinor(invoice.discountAmount),
      taxMinor: moneyToMinor(invoice.tax),
      totalMinor: moneyToMinor(invoice.total),
    });

    for (const lineItem of invoice.lineItems ?? []) {
      records.lineItems.push({
        ...copy(lineItem, ['id', 'invoiceId', 'description', 'itemType', 'quantity', 'position']),
        unitPriceMinor: moneyToMinor(lineItem.unitPrice),
        totalMinor: moneyToMinor(lineItem.total),
      });
    }
    for (const attempt of invoice.deliveryAttempts ?? []) {
      records.deliveryAttempts.push(copy(attempt, [
        'id', 'invoiceId', 'requestId', 'attemptNumber', 'kind', 'status', 'provider',
        'providerMessageId', 'failureCode', 'providerLifecycleStatus', 'lastProviderEventAt',
        'recipientServerAcceptedAt', 'temporaryFailureAt', 'permanentFailureAt', 'acceptedAt',
        'failedAt', 'outcomeUnknownAt', 'canceledAt', 'createdAt', 'updatedAt',
      ], [
        'lastProviderEventAt', 'recipientServerAcceptedAt', 'temporaryFailureAt',
        'permanentFailureAt', 'acceptedAt', 'failedAt', 'outcomeUnknownAt', 'canceledAt',
        'createdAt', 'updatedAt',
      ]));
      for (const event of attempt.events ?? []) {
        records.deliveryEvents.push(copy(event, [
          'id', 'attemptId', 'invoiceId', 'status', 'providerMessageId', 'failureCode',
          'providerEventId', 'providerEventKey', 'providerOccurredAt', 'occurredAt', 'createdAt',
        ], ['providerOccurredAt', 'occurredAt', 'createdAt']));
      }
    }
    for (const payment of invoice.payments ?? []) {
      records.payments.push(copy(payment, [
        'id', 'invoiceId', 'amountMinor', 'currency', 'method', 'transactionId', 'paidAt',
        'createdAt', 'settlementEvidenceStatus', 'stripeChargeId',
        'stripeBalanceTransactionId', 'settlementGrossMinor', 'providerFeeMinor',
        'settlementNetMinor', 'settlementCurrency', 'settlementReconciledAt',
        'settlementReconciliationReason',
      ], ['paidAt', 'createdAt', 'settlementReconciledAt']));
      for (const refund of payment.refunds ?? []) {
        records.refunds.push(copy(refund, [
          'id', 'invoiceId', 'paymentId', 'stripeRefundId', 'amountMinor', 'currency',
          'status', 'failureReason', 'providerCreatedAt', 'lastProviderEventAt',
          'lastStripeEventId', 'createdAt', 'updatedAt',
        ], ['providerCreatedAt', 'lastProviderEventAt', 'createdAt', 'updatedAt']));
      }
      for (const event of payment.settlementEvents ?? []) {
        records.settlementEvents.push(copy(event, [
          'id', 'invoiceId', 'paymentId', 'requestId', 'status', 'paymentIntentId',
          'stripeChargeId', 'stripeBalanceTransactionId', 'chargeAmountMinor',
          'chargeCurrency', 'settlementGrossMinor', 'providerFeeMinor', 'settlementNetMinor',
          'settlementCurrency', 'reasonCode', 'occurredAt', 'createdAt',
        ], ['occurredAt', 'createdAt']));
      }
    }
    for (const event of invoice.refundEvents ?? []) {
      records.refundEvents.push(copy(event, [
        'id', 'invoiceId', 'refundId', 'stripeRefundId', 'stripeEventId', 'eventType',
        'paymentIntentId', 'amountMinor', 'currency', 'status', 'signedStatus',
        'providerEventAt', 'createdAt',
      ], ['providerEventAt', 'createdAt']));
    }
    for (const audit of invoice.checkoutAudits ?? []) {
      records.checkoutAudits.push(copy(audit, [
        'id', 'invoiceId', 'checkoutSessionId', 'checkoutAttempt', 'action', 'outcome',
        'providerStatus', 'reasonCode', 'actorUserId', 'createdAt',
      ], ['createdAt']));
    }
  }

  for (const collection of REVENUE_EVIDENCE_COLLECTIONS) records[collection].sort(byId);
  return {
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId,
    exportedAt: exportedAtIso,
    records,
    manifest: buildRevenueEvidenceManifest(records),
  };
}

function collectionRecords(records, collection) {
  return Array.isArray(records?.[collection]) ? records[collection] : [];
}

export function buildRevenueEvidenceManifest(records) {
  const normalized = Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(
    collection => [collection, collectionRecords(records, collection)],
  ));
  return {
    version: 1,
    collections: Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [
      collection,
      {
        count: normalized[collection].length,
        sha256: sha256(normalized[collection]),
      },
    ])),
    recordsSha256: sha256(normalized),
  };
}

function recordIds(records, collection) {
  return new Set(collectionRecords(records, collection).map(record => record?.id).filter(Boolean));
}

function verifyUniqueIds(findings, records) {
  for (const collection of REVENUE_EVIDENCE_COLLECTIONS) {
    const seen = new Set();
    for (const record of collectionRecords(records, collection)) {
      if (typeof record?.id !== 'string') continue;
      if (seen.has(record.id)) {
        findings.push({ code: 'DUPLICATE_RECORD_ID', collection, id: record.id });
      } else {
        seen.add(record.id);
      }
    }
  }
}

function verifyReference(findings, records, collection, field, parentCollection, code) {
  const allowed = recordIds(records, parentCollection);
  for (const record of collectionRecords(records, collection)) {
    if (typeof record?.[field] === 'string' && !allowed.has(record[field])) {
      findings.push({ code, id: record.id, [field]: record[field] });
    }
  }
}

export function verifyRevenueEvidenceExport(payload) {
  if (payload?.format !== 'ashbi-revenue-evidence-export'
    || payload?.version !== 1
    || typeof payload?.organizationId !== 'string'
    || !payload?.records
    || typeof payload.records !== 'object') {
    return { valid: false, findings: [{ code: 'EXPORT_FORMAT_INVALID' }], manifest: null };
  }

  const findings = [];
  const expectedManifest = buildRevenueEvidenceManifest(payload.records);
  for (const collection of REVENUE_EVIDENCE_COLLECTIONS) {
    const actual = payload.manifest?.collections?.[collection];
    const expected = expectedManifest.collections[collection];
    if (!actual || actual.count !== expected.count || actual.sha256 !== expected.sha256) {
      findings.push({ code: 'MANIFEST_MISMATCH', collection });
    }
  }
  if (findings.length === 0 && payload.manifest?.recordsSha256 !== expectedManifest.recordsSha256) {
    findings.push({ code: 'RECORDS_CHECKSUM_MISMATCH' });
  }

  verifyUniqueIds(findings, payload.records);
  verifyReference(findings, payload.records, 'lineItems', 'invoiceId', 'invoices', 'LINE_ITEM_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'deliveryAttempts', 'invoiceId', 'invoices', 'DELIVERY_ATTEMPT_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'deliveryEvents', 'invoiceId', 'invoices', 'DELIVERY_EVENT_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'deliveryEvents', 'attemptId', 'deliveryAttempts', 'DELIVERY_EVENT_ATTEMPT_MISSING');
  verifyReference(findings, payload.records, 'payments', 'invoiceId', 'invoices', 'PAYMENT_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'refunds', 'invoiceId', 'invoices', 'REFUND_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'refunds', 'paymentId', 'payments', 'REFUND_PAYMENT_MISSING');
  verifyReference(findings, payload.records, 'refundEvents', 'invoiceId', 'invoices', 'REFUND_EVENT_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'refundEvents', 'refundId', 'refunds', 'REFUND_EVENT_REFUND_MISSING');
  verifyReference(findings, payload.records, 'settlementEvents', 'invoiceId', 'invoices', 'SETTLEMENT_EVENT_INVOICE_MISSING');
  verifyReference(findings, payload.records, 'settlementEvents', 'paymentId', 'payments', 'SETTLEMENT_EVENT_PAYMENT_MISSING');
  verifyReference(findings, payload.records, 'checkoutAudits', 'invoiceId', 'invoices', 'CHECKOUT_AUDIT_INVOICE_MISSING');

  for (const invoice of collectionRecords(payload.records, 'invoices')) {
    if (!['CAD', 'USD'].includes(invoice.currency)) {
      findings.push({ code: 'INVOICE_CURRENCY_UNRESOLVED', id: invoice.id, currency: invoice.currency ?? null });
    }
    if (!Number.isInteger(invoice.totalMinor)) {
      findings.push({ code: 'INVOICE_EXACT_TOTAL_UNRESOLVED', id: invoice.id });
    }
  }
  for (const lineItem of collectionRecords(payload.records, 'lineItems')) {
    if (!Number.isInteger(lineItem.totalMinor)) {
      findings.push({ code: 'LINE_ITEM_EXACT_TOTAL_UNRESOLVED', id: lineItem.id });
    }
  }
  for (const payment of collectionRecords(payload.records, 'payments')) {
    if (!Number.isInteger(payment.amountMinor) || !['CAD', 'USD'].includes(payment.currency)) {
      findings.push({ code: 'PAYMENT_EXACT_AMOUNT_UNRESOLVED', id: payment.id });
    }
    const settlementRequired = !NON_STRIPE_SETTLEMENT_METHODS.has(payment.method);
    if (settlementRequired && payment.settlementEvidenceStatus !== 'VERIFIED') {
      findings.push({
        code: 'PAYMENT_SETTLEMENT_UNRESOLVED',
        id: payment.id,
        status: payment.settlementEvidenceStatus ?? null,
      });
    } else if (settlementRequired && (!Number.isInteger(payment.settlementGrossMinor)
      || !Number.isInteger(payment.providerFeeMinor)
      || !Number.isInteger(payment.settlementNetMinor)
      || !['CAD', 'USD'].includes(payment.settlementCurrency)
      || payment.settlementGrossMinor - payment.providerFeeMinor !== payment.settlementNetMinor)) {
      findings.push({ code: 'PAYMENT_SETTLEMENT_AMOUNTS_INVALID', id: payment.id });
    }
  }
  const paymentsById = new Map(collectionRecords(payload.records, 'payments').map(payment => [payment.id, payment]));
  for (const refund of collectionRecords(payload.records, 'refunds')) {
    const payment = paymentsById.get(refund.paymentId);
    if (!Number.isInteger(refund.amountMinor) || !['CAD', 'USD'].includes(refund.currency)) {
      findings.push({ code: 'REFUND_EXACT_AMOUNT_UNRESOLVED', id: refund.id });
    }
    if (payment
      && ['CAD', 'USD'].includes(payment.currency)
      && ['CAD', 'USD'].includes(refund.currency)
      && refund.currency !== payment.currency) {
      findings.push({
        code: 'REFUND_PAYMENT_CURRENCY_MISMATCH',
        id: refund.id,
        paymentId: refund.paymentId,
        currency: refund.currency ?? null,
        paymentCurrency: payment.currency ?? null,
      });
    }
  }

  return { valid: findings.length === 0, findings, manifest: expectedManifest };
}
