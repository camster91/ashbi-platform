import assert from 'node:assert/strict';
import test from 'node:test';

const revenueExport = await import('../../services/revenueEvidenceExport.service.js').catch(() => ({}));

const records = {
  invoices: [{ id: 'invoice-1', clientId: 'client-1', currency: 'CAD', totalMinor: 11300 }],
  lineItems: [{ id: 'line-1', invoiceId: 'invoice-1', totalMinor: 10000 }],
  deliveryAttempts: [{ id: 'attempt-1', invoiceId: 'invoice-1' }],
  deliveryEvents: [{ id: 'delivery-event-1', invoiceId: 'invoice-1', attemptId: 'attempt-1' }],
  payments: [{
    id: 'payment-1',
    invoiceId: 'invoice-1',
    currency: 'CAD',
    amountMinor: 11300,
    settlementEvidenceStatus: 'VERIFIED',
    settlementGrossMinor: 11300,
    providerFeeMinor: 400,
    settlementNetMinor: 10900,
    settlementCurrency: 'CAD',
  }],
  refunds: [{ id: 'refund-1', invoiceId: 'invoice-1', paymentId: 'payment-1', currency: 'CAD', amountMinor: 1000 }],
  refundEvents: [{ id: 'refund-event-1', invoiceId: 'invoice-1', refundId: 'refund-1' }],
  settlementEvents: [{ id: 'settlement-1', invoiceId: 'invoice-1', paymentId: 'payment-1' }],
  checkoutAudits: [{ id: 'checkout-1', invoiceId: 'invoice-1' }],
};

test('revenue evidence manifest is deterministic when record object keys are reordered', () => {
  assert.equal(typeof revenueExport.buildRevenueEvidenceManifest, 'function');
  const reordered = {
    ...records,
    invoices: [{ totalMinor: 11300, currency: 'CAD', clientId: 'client-1', id: 'invoice-1' }],
  };

  assert.deepEqual(
    revenueExport.buildRevenueEvidenceManifest(records),
    revenueExport.buildRevenueEvidenceManifest(reordered),
  );
  assert.match(revenueExport.buildRevenueEvidenceManifest(records).recordsSha256, /^[a-f0-9]{64}$/);
});

test('revenue evidence manifest preserves Date values in its checksum', () => {
  const first = { ...records, invoices: [{ ...records.invoices[0], issueDate: new Date('2026-08-01T00:00:00.000Z') }] };
  const second = { ...records, invoices: [{ ...records.invoices[0], issueDate: new Date('2026-08-02T00:00:00.000Z') }] };

  assert.notEqual(
    revenueExport.buildRevenueEvidenceManifest(first).recordsSha256,
    revenueExport.buildRevenueEvidenceManifest(second).recordsSha256,
  );
});

test('revenue evidence verification rejects tampering and broken invoice references', () => {
  assert.equal(typeof revenueExport.verifyRevenueEvidenceExport, 'function');
  const manifest = revenueExport.buildRevenueEvidenceManifest(records);
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: {
      ...records,
      payments: [{ ...records.payments[0], invoiceId: 'missing-invoice' }],
    },
    manifest,
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'MANIFEST_MISMATCH', collection: 'payments' },
    { code: 'PAYMENT_INVOICE_MISSING', id: 'payment-1', invoiceId: 'missing-invoice' },
  ]);
});

test('revenue evidence verification rejects duplicate record identifiers', () => {
  const duplicateRecords = {
    ...records,
    invoices: [records.invoices[0], { ...records.invoices[0] }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: duplicateRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(duplicateRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'DUPLICATE_RECORD_ID', collection: 'invoices', id: 'invoice-1' },
  ]);
});

test('revenue evidence keeps unresolved currency and settlement gaps visible', () => {
  const unresolvedRecords = {
    ...records,
    invoices: [{ ...records.invoices[0], currency: 'UNASSIGNED' }],
    payments: [{
      ...records.payments[0],
      method: 'STRIPE',
      amountMinor: null,
      currency: null,
      settlementEvidenceStatus: 'PENDING',
    }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: unresolvedRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(unresolvedRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'INVOICE_CURRENCY_UNRESOLVED', id: 'invoice-1', currency: 'UNASSIGNED' },
    { code: 'PAYMENT_EXACT_AMOUNT_UNRESOLVED', id: 'payment-1' },
    { code: 'PAYMENT_SETTLEMENT_UNRESOLVED', id: 'payment-1', status: 'PENDING' },
  ]);
});

test('exact non-Stripe payments do not invent provider settlement evidence', () => {
  const bankRecords = {
    ...records,
    payments: [{
      ...records.payments[0],
      method: 'BANK',
      settlementEvidenceStatus: 'PENDING',
      settlementGrossMinor: null,
      providerFeeMinor: null,
      settlementNetMinor: null,
      settlementCurrency: null,
    }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: bankRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(bankRecords),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.findings, []);
});

test('revenue evidence verification rejects orphaned child evidence', () => {
  const orphaned = {
    ...records,
    lineItems: [{ ...records.lineItems[0], invoiceId: 'missing-invoice' }],
    deliveryAttempts: [{ ...records.deliveryAttempts[0], invoiceId: 'missing-invoice' }],
    deliveryEvents: [{ ...records.deliveryEvents[0], invoiceId: 'missing-invoice', attemptId: 'missing-attempt' }],
    payments: [{ ...records.payments[0], invoiceId: 'missing-invoice' }],
    refunds: [{ ...records.refunds[0], invoiceId: 'missing-invoice', paymentId: 'missing-payment' }],
    refundEvents: [{ ...records.refundEvents[0], invoiceId: 'missing-invoice', refundId: 'missing-refund' }],
    settlementEvents: [{ ...records.settlementEvents[0], invoiceId: 'missing-invoice', paymentId: 'missing-payment' }],
    checkoutAudits: [{ ...records.checkoutAudits[0], invoiceId: 'missing-invoice' }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: orphaned,
    manifest: revenueExport.buildRevenueEvidenceManifest(orphaned),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'LINE_ITEM_INVOICE_MISSING', id: 'line-1', invoiceId: 'missing-invoice' },
    { code: 'DELIVERY_ATTEMPT_INVOICE_MISSING', id: 'attempt-1', invoiceId: 'missing-invoice' },
    { code: 'DELIVERY_EVENT_INVOICE_MISSING', id: 'delivery-event-1', invoiceId: 'missing-invoice' },
    { code: 'DELIVERY_EVENT_ATTEMPT_MISSING', id: 'delivery-event-1', attemptId: 'missing-attempt' },
    { code: 'PAYMENT_INVOICE_MISSING', id: 'payment-1', invoiceId: 'missing-invoice' },
    { code: 'REFUND_INVOICE_MISSING', id: 'refund-1', invoiceId: 'missing-invoice' },
    { code: 'REFUND_PAYMENT_MISSING', id: 'refund-1', paymentId: 'missing-payment' },
    { code: 'REFUND_EVENT_INVOICE_MISSING', id: 'refund-event-1', invoiceId: 'missing-invoice' },
    { code: 'REFUND_EVENT_REFUND_MISSING', id: 'refund-event-1', refundId: 'missing-refund' },
    { code: 'SETTLEMENT_EVENT_INVOICE_MISSING', id: 'settlement-1', invoiceId: 'missing-invoice' },
    { code: 'SETTLEMENT_EVENT_PAYMENT_MISSING', id: 'settlement-1', paymentId: 'missing-payment' },
    { code: 'CHECKOUT_AUDIT_INVOICE_MISSING', id: 'checkout-1', invoiceId: 'missing-invoice' },
  ]);
});

test('verified settlement evidence requires exact gross fee and net arithmetic', () => {
  const invalidRecords = {
    ...records,
    payments: [{
      ...records.payments[0],
      settlementNetMinor: 10899,
    }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: invalidRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(invalidRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'PAYMENT_SETTLEMENT_AMOUNTS_INVALID', id: 'payment-1' },
  ]);
});

test('refund evidence must preserve the exact payment currency', () => {
  const invalidRecords = {
    ...records,
    refunds: [{ ...records.refunds[0], currency: 'USD' }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: invalidRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(invalidRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    {
      code: 'REFUND_PAYMENT_CURRENCY_MISMATCH',
      id: 'refund-1',
      paymentId: 'payment-1',
      currency: 'USD',
      paymentCurrency: 'CAD',
    },
  ]);
});

test('invoice line and refund evidence require exact minor-unit amounts', () => {
  const invalidRecords = {
    ...records,
    invoices: [{ ...records.invoices[0], totalMinor: null }],
    lineItems: [{ ...records.lineItems[0], totalMinor: null }],
    refunds: [{ ...records.refunds[0], amountMinor: null, currency: null }],
  };
  const result = revenueExport.verifyRevenueEvidenceExport({
    format: 'ashbi-revenue-evidence-export',
    version: 1,
    organizationId: 'org-1',
    records: invalidRecords,
    manifest: revenueExport.buildRevenueEvidenceManifest(invalidRecords),
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.findings, [
    { code: 'INVOICE_EXACT_TOTAL_UNRESOLVED', id: 'invoice-1' },
    { code: 'LINE_ITEM_EXACT_TOTAL_UNRESOLVED', id: 'line-1' },
    { code: 'REFUND_EXACT_AMOUNT_UNRESOLVED', id: 'refund-1' },
  ]);
});

test('revenue evidence collection flattens tenant-scoped records without secret-bearing fields', async () => {
  assert.equal(typeof revenueExport.createRevenueEvidenceExport, 'function');
  let query;
  const prisma = {
    invoice: {
      findMany: async input => {
        query = input;
        return [{
          id: 'invoice-1',
          invoiceNumber: 'INV-001',
          clientId: 'client-1',
          projectId: 'project-1',
          proposalId: null,
          bonsaiInvoiceId: 'bonsai-1',
          status: 'PAID',
          currency: 'CAD',
          subtotal: 100,
          discountAmount: 0,
          taxRate: 13,
          taxType: 'HST',
          tax: 13,
          total: 113,
          issueDate: new Date('2026-08-01T00:00:00.000Z'),
          dueDate: new Date('2026-08-15T00:00:00.000Z'),
          paidAt: new Date('2026-08-05T00:00:00.000Z'),
          sentAt: new Date('2026-08-02T00:00:00.000Z'),
          voidedAt: null,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          updatedAt: new Date('2026-08-05T00:00:00.000Z'),
          viewToken: 'must-not-export',
          stripePaymentLink: 'must-not-export',
          notes: 'must-not-export',
          internalNotes: 'must-not-export',
          lineItems: [{
            id: 'line-1', invoiceId: 'invoice-1', description: 'Design', itemType: 'LABOR',
            quantity: 1, unitPrice: 100, total: 100, position: 0,
          }],
          deliveryAttempts: [{
            id: 'attempt-1', invoiceId: 'invoice-1', requestId: 'request-1', attemptNumber: 1,
            kind: 'INITIAL', recipient: 'private@example.test', status: 'PROVIDER_ACCEPTED',
            provider: 'MAILGUN', providerMessageId: 'message-1', failureCode: null,
            providerLifecycleStatus: 'RECIPIENT_SERVER_ACCEPTED', lastProviderEventAt: new Date('2026-08-02T00:01:00.000Z'),
            recipientServerAcceptedAt: new Date('2026-08-02T00:01:00.000Z'), temporaryFailureAt: null,
            permanentFailureAt: null, acceptedAt: new Date('2026-08-02T00:00:00.000Z'), failedAt: null,
            outcomeUnknownAt: null, canceledAt: null, createdAt: new Date('2026-08-02T00:00:00.000Z'),
            updatedAt: new Date('2026-08-02T00:01:00.000Z'),
            events: [{
              id: 'delivery-event-1', attemptId: 'attempt-1', invoiceId: 'invoice-1',
              status: 'RECIPIENT_SERVER_ACCEPTED', providerMessageId: 'message-1', failureCode: null,
              providerEventId: 'provider-event-1', providerEventKey: 'provider-key-1',
              providerOccurredAt: new Date('2026-08-02T00:01:00.000Z'),
              occurredAt: new Date('2026-08-02T00:01:00.000Z'), createdAt: new Date('2026-08-02T00:01:00.000Z'),
            }],
          }],
          payments: [{
            id: 'payment-1', invoiceId: 'invoice-1', amount: 113, amountMinor: 11300, currency: 'CAD',
            method: 'STRIPE', transactionId: 'pi_1', paidAt: new Date('2026-08-05T00:00:00.000Z'),
            createdAt: new Date('2026-08-05T00:00:00.000Z'), settlementEvidenceStatus: 'VERIFIED',
            stripeChargeId: 'ch_1', stripeBalanceTransactionId: 'txn_1', settlementGrossMinor: 11300,
            providerFeeMinor: 400, settlementNetMinor: 10900, settlementCurrency: 'CAD',
            settlementReconciledAt: new Date('2026-08-05T00:02:00.000Z'), settlementReconciliationReason: null,
            notes: 'must-not-export',
            refunds: [{
              id: 'refund-1', invoiceId: 'invoice-1', paymentId: 'payment-1', stripeRefundId: 're_1',
              amountMinor: 1000, currency: 'CAD', status: 'succeeded', failureReason: null,
              providerCreatedAt: new Date('2026-08-06T00:00:00.000Z'),
              lastProviderEventAt: new Date('2026-08-06T00:00:00.000Z'), lastStripeEventId: 'evt_refund',
              createdAt: new Date('2026-08-06T00:00:00.000Z'), updatedAt: new Date('2026-08-06T00:00:00.000Z'),
            }],
            settlementEvents: [{
              id: 'settlement-1', invoiceId: 'invoice-1', paymentId: 'payment-1', requestId: 'settle-1',
              status: 'VERIFIED', paymentIntentId: 'pi_1', stripeChargeId: 'ch_1',
              stripeBalanceTransactionId: 'txn_1', chargeAmountMinor: 11300, chargeCurrency: 'CAD',
              settlementGrossMinor: 11300, providerFeeMinor: 400, settlementNetMinor: 10900,
              settlementCurrency: 'CAD', reasonCode: null, occurredAt: new Date('2026-08-05T00:02:00.000Z'),
              createdAt: new Date('2026-08-05T00:02:00.000Z'),
            }],
          }],
          refundEvents: [{
            id: 'refund-event-1', invoiceId: 'invoice-1', refundId: 'refund-1', stripeRefundId: 're_1',
            stripeEventId: 'evt_refund', eventType: 'refund.created', paymentIntentId: 'pi_1',
            amountMinor: 1000, currency: 'CAD', status: 'succeeded', signedStatus: 'succeeded',
            providerEventAt: new Date('2026-08-06T00:00:00.000Z'), createdAt: new Date('2026-08-06T00:00:00.000Z'),
          }],
          checkoutAudits: [{
            id: 'checkout-1', invoiceId: 'invoice-1', checkoutSessionId: 'cs_1', checkoutAttempt: 1,
            action: 'CREATE', outcome: 'SUCCEEDED', providerStatus: 'open', reasonCode: null,
            actorUserId: 'user-1', createdAt: new Date('2026-08-03T00:00:00.000Z'),
          }],
        }];
      },
    },
  };

  const result = await revenueExport.createRevenueEvidenceExport({
    prisma,
    organizationId: 'org-1',
    exportedAt: new Date('2026-08-27T05:00:00.000Z'),
  });

  assert.equal(result.format, 'ashbi-revenue-evidence-export');
  assert.equal(result.organizationId, 'org-1');
  assert.equal(result.exportedAt, '2026-08-27T05:00:00.000Z');
  assert.deepEqual(Object.fromEntries(Object.entries(result.records).map(([key, value]) => [key, value.length])), {
    invoices: 1, lineItems: 1, deliveryAttempts: 1, deliveryEvents: 1, payments: 1,
    refunds: 1, refundEvents: 1, settlementEvents: 1, checkoutAudits: 1,
  });
  assert.equal(result.records.invoices[0].totalMinor, 11300);
  assert.equal(result.records.lineItems[0].unitPriceMinor, 10000);
  assert.equal(result.records.deliveryAttempts[0].recipient, undefined);
  assert.equal(result.records.payments[0].notes, undefined);
  assert.doesNotMatch(JSON.stringify(result), /must-not-export|private@example\.test/);
  assert.deepEqual(query.where, { deletedAt: null, client: { organizationId: 'org-1' } });
  assert.deepEqual(query.orderBy, [{ issueDate: 'asc' }, { id: 'asc' }]);
  assert.equal(revenueExport.verifyRevenueEvidenceExport(result).valid, true);
});
