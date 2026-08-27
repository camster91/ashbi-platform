import { REVENUE_EVIDENCE_COLLECTIONS, verifyRevenueEvidenceExport } from './revenueEvidenceExport.service.js';

const STATUS_MAP = Object.freeze({
  paid: 'PAID',
  overdue: 'OVERDUE',
  drafted: 'DRAFT',
  draft: 'DRAFT',
  scheduled: 'DRAFT',
  sent: 'SENT',
  void: 'VOID',
});

function bonsaiId(row) {
  const match = String(row?.contractor_invoice_link ?? '').trim().match(/\/invoices\/(\d+)\/?$/);
  return match?.[1] ?? String(row?.invoice_number ?? '').trim();
}

function exactMinor(value) {
  const raw = String(value ?? '').trim();
  const valid = raw.includes(',')
    ? /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw)
    : /^\d+(?:\.\d{1,2})?$/.test(raw);
  if (!valid) return null;
  const normalized = raw.replace(/,/g, '');
  const [whole, fraction = ''] = normalized.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(minor) ? minor : null;
}

function requireSha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function reconcileBonsaiRevenue({
  organizationId,
  completedAt,
  bonsaiInvoicesSha256,
  revenueArtifactSha256,
  bonsaiRows,
  revenueExport,
}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required');
  if (revenueExport?.organizationId !== organizationId || !verifyRevenueEvidenceExport(revenueExport).valid) {
    throw new TypeError('A valid tenant-matched revenue export is required');
  }
  const completed = new Date(completedAt);
  if (Number.isNaN(completed.getTime())) throw new TypeError('completedAt must be a valid date');
  const exported = new Date(revenueExport.exportedAt);
  if (Number.isNaN(exported.getTime())) throw new TypeError('revenue export must include a valid exportedAt');
  if (completed < exported) throw new TypeError('completedAt must not predate the revenue evidence export');
  if (!Array.isArray(bonsaiRows)) throw new TypeError('bonsaiRows must be an array');

  const hubInvoices = (revenueExport.records.invoices ?? []).filter(invoice => invoice.bonsaiInvoiceId);
  const findings = [];
  const sourceCounts = new Map();
  for (const row of bonsaiRows) {
    const sourceId = bonsaiId(row);
    sourceCounts.set(sourceId, (sourceCounts.get(sourceId) ?? 0) + 1);
  }
  const hubGroups = new Map();
  for (const invoice of hubInvoices) {
    const sourceId = String(invoice.bonsaiInvoiceId);
    hubGroups.set(sourceId, [...(hubGroups.get(sourceId) ?? []), invoice]);
  }
  const ambiguousIds = new Set();
  for (const [sourceId, rows] of sourceCounts) {
    if (rows > 1) {
      ambiguousIds.add(sourceId);
      findings.push({ code: 'DUPLICATE_BONSAI_INVOICE_ID', sourceId, rows });
    }
  }
  for (const [sourceId, invoices] of hubGroups) {
    if (invoices.length > 1) {
      ambiguousIds.add(sourceId);
      findings.push({
        code: 'DUPLICATE_HUB_BONSAI_INVOICE_ID',
        sourceId,
        hubInvoiceIds: invoices.map(invoice => invoice.id).sort(),
      });
    }
  }
  const hubByBonsaiId = new Map([...hubGroups].map(([sourceId, invoices]) => [sourceId, invoices[0]]));
  const paymentsByInvoice = new Map();
  for (const payment of revenueExport.records.payments ?? []) {
    paymentsByInvoice.set(payment.invoiceId, [...(paymentsByInvoice.get(payment.invoiceId) ?? []), payment]);
  }
  const sourceIds = new Set();
  let currenciesSeparated = true;
  let matchedInvoices = 0;
  for (const row of bonsaiRows) {
    const sourceId = bonsaiId(row);
    const invoiceNumber = String(row.invoice_number ?? '').trim();
    sourceIds.add(sourceId);
    if (ambiguousIds.has(sourceId)) continue;
    const status = STATUS_MAP[String(row.status ?? '').trim().toLowerCase()] ?? null;
    const currency = String(row.currency ?? '').trim().toUpperCase();
    const totalMinor = exactMinor(row.total_amount);
    const invalidFields = [];
    if (!invoiceNumber) invalidFields.push('invoice_number');
    if (!status) invalidFields.push('status');
    if (!['CAD', 'USD'].includes(currency)) {
      invalidFields.push('currency');
      currenciesSeparated = false;
    }
    if (!Number.isInteger(totalMinor)) invalidFields.push('total_amount');
    if (invalidFields.length > 0) {
      findings.push({
        code: 'BONSAI_INVOICE_SOURCE_INVALID', sourceId, invoiceNumber, fields: invalidFields,
      });
      continue;
    }
    const hubInvoice = hubByBonsaiId.get(sourceId);
    if (!hubInvoice) {
      findings.push({ code: 'BONSAI_INVOICE_MISSING_IN_HUB', sourceId, invoiceNumber });
      continue;
    }
    if (hubInvoice.invoiceNumber !== invoiceNumber) {
      findings.push({
        code: 'INVOICE_NUMBER_MISMATCH', sourceId, bonsai: invoiceNumber, hub: hubInvoice.invoiceNumber,
      });
    }
    if (hubInvoice.status !== status) {
      findings.push({ code: 'INVOICE_STATUS_MISMATCH', sourceId, invoiceNumber, bonsai: status, hub: hubInvoice.status });
    }
    if (hubInvoice.currency !== currency) {
      findings.push({ code: 'INVOICE_CURRENCY_MISMATCH', sourceId, invoiceNumber, bonsai: currency, hub: hubInvoice.currency });
    }
    if (hubInvoice.totalMinor !== totalMinor) {
      findings.push({ code: 'INVOICE_TOTAL_MISMATCH', sourceId, invoiceNumber, bonsaiMinor: totalMinor, hubMinor: hubInvoice.totalMinor });
    }
    let paymentEvidenceMatches = true;
    if (status === 'PAID') {
      const evidencedMinor = (paymentsByInvoice.get(hubInvoice.id) ?? [])
        .filter(payment => payment.currency === currency && Number.isInteger(payment.amountMinor))
        .reduce((sum, payment) => sum + payment.amountMinor, 0);
      if (evidencedMinor !== totalMinor) {
        paymentEvidenceMatches = false;
        findings.push({
          code: 'PAID_INVOICE_PAYMENT_EVIDENCE_MISSING',
          sourceId,
          invoiceNumber,
          expectedMinor: totalMinor,
          currency,
          evidencedMinor,
        });
      }
    }
    if (hubInvoice.invoiceNumber === invoiceNumber
      && hubInvoice.status === status
      && hubInvoice.currency === currency
      && hubInvoice.totalMinor === totalMinor
      && paymentEvidenceMatches) {
      matchedInvoices += 1;
    }
  }
  for (const hubInvoice of hubInvoices) {
    const sourceId = String(hubInvoice.bonsaiInvoiceId);
    if (ambiguousIds.has(sourceId)) continue;
    if (!sourceIds.has(sourceId)) {
      findings.push({
        code: 'HUB_BONSAI_INVOICE_MISSING_IN_SOURCE',
        sourceId,
        invoiceNumber: hubInvoice.invoiceNumber,
        hubInvoiceId: hubInvoice.id,
      });
    }
  }

  return {
    format: 'ashbi-parallel-reconciliation',
    version: 1,
    complete: findings.length === 0,
    organizationId,
    completedAt: completed.toISOString(),
    unresolvedFindings: findings.length,
    currenciesSeparated,
    summary: {
      sourceInvoices: bonsaiRows.length,
      hubBonsaiInvoices: hubInvoices.length,
      matchedInvoices,
    },
    findings,
    sourceEvidence: {
      invoicesSha256: requireSha256(bonsaiInvoicesSha256, 'bonsaiInvoicesSha256'),
      invoiceRows: bonsaiRows.length,
    },
    revenueEvidence: {
      artifactSha256: requireSha256(revenueArtifactSha256, 'revenueArtifactSha256'),
      recordsSha256: revenueExport.manifest.recordsSha256,
      collectionCounts: Object.fromEntries(REVENUE_EVIDENCE_COLLECTIONS.map(collection => [
        collection,
        revenueExport.manifest.collections[collection].count,
      ])),
    },
  };
}
