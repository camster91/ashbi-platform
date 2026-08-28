import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildControlledJourneyEvidence,
  readControlledJourneySnapshot,
} from '../../services/controlledJourneyEvidence.service.js';

function readiness() {
  return { ready: true, checks: [{ id: 'sandbox-flag', ok: true }, { id: 'stripe-restricted-test-key', ok: true }] };
}

function snapshot() {
  return {
    lead: {
      id: 'lead-1', organizationId: 'org-1', status: 'CONVERTED',
      convertedClientId: 'client-1', convertedDealId: 'deal-1',
    },
    client: { id: 'client-1', organizationId: 'org-1' },
    deal: { id: 'deal-1', clientId: 'client-1', organizationId: 'org-1', currency: 'CAD' },
    proposal: {
      id: 'proposal-1', dealId: 'deal-1', clientId: 'client-1', projectId: 'project-1',
      status: 'APPROVED', currency: 'CAD',
    },
    contract: {
      id: 'contract-1', proposalId: 'proposal-1', clientId: 'client-1', status: 'SIGNED',
      signedAt: new Date('2026-08-27T12:00:00.000Z'),
    },
    project: {
      id: 'project-1', clientId: 'client-1', organizationId: 'org-1',
      sourceContractId: 'contract-1', createdAt: new Date('2026-08-27T12:01:00.000Z'),
    },
    task: {
      id: 'task-1', title: 'Deliver the synthetic engagement', projectId: 'project-1',
      status: 'COMPLETED', completedAt: new Date('2026-08-27T12:08:00.000Z'),
    },
    invoice: {
      id: 'invoice-1', proposalId: 'proposal-1', clientId: 'client-1', projectId: 'project-1',
      status: 'PAID', currency: 'CAD', total: 113, paidAt: new Date('2026-08-27T12:10:00.000Z'),
      stripePaymentIntentId: 'pi_test_1', stripeCheckoutReconciliationRequiredAt: null,
      stripeCheckoutReconciliationReason: null,
      deliveryAttempts: [{
        provider: 'MAILGUN', providerLifecycleStatus: 'RECIPIENT_SERVER_ACCEPTED',
        recipientServerAcceptedAt: new Date('2026-08-27T12:05:00.000Z'),
      }],
    },
    payment: {
      id: 'payment-1', invoiceId: 'invoice-1', method: 'STRIPE', stripeLivemode: false,
      transactionId: 'pi_test_1', amountMinor: 11300, currency: 'CAD',
      settlementEvidenceStatus: 'VERIFIED', settlementGrossMinor: 11300,
      providerFeeMinor: 400, settlementNetMinor: 10900, settlementCurrency: 'CAD',
      settlementReconciledAt: new Date('2026-08-27T12:15:00.000Z'),
    },
    report: {
      id: 'report-1', clientId: 'client-1', subject: 'Synthetic engagement report',
      body: 'The controlled engagement and payment are complete.',
      generatedAt: new Date('2026-08-27T12:20:00.000Z'),
    },
    sourceCounts: {
      inquiryEvents: 1, lead: 1, proposal: 1, contract: 1, project: 1, task: 1,
      invoice: 1, payment: 1, report: 1,
    },
  };
}

function build(overrides = {}) {
  return buildControlledJourneyEvidence({
    organizationId: 'org-1',
    publicSiteRevision: 'abcdef1',
    hubRevision: 'abcdef2',
    snapshot: snapshot(),
    sandboxReadiness: readiness(),
    attestation: {
      noManualDatabaseCorrections: true,
      attestedBy: 'Cameron',
      reference: 'sandbox-run-2026-08-27',
    },
    generatedAt: new Date('2026-08-27T13:00:00.000Z'),
    ...overrides,
  });
}

test('controlled journey evidence is derived from one reconciled organization-bound sandbox chain', () => {
  const evidence = build();
  assert.equal(evidence.complete, true);
  assert.equal(evidence.organizationId, 'org-1');
  assert.equal(evidence.stripeMode, 'test');
  assert.equal(evidence.providerEvidence.stripeLivemode, false);
  assert.equal(evidence.duplicateWrites, 0);
  assert.equal(evidence.manualDatabaseCorrections, 0);
  assert.deepEqual(evidence.recordIds, {
    lead: 'lead-1', client: 'client-1', opportunity: 'deal-1', proposal: 'proposal-1',
    contract: 'contract-1', project: 'project-1', task: 'task-1', invoice: 'invoice-1',
    payment: 'payment-1', report: 'report-1',
  });
});

test('controlled journey evidence rejects duplicate, cross-tenant, live, unlinked, and unresolved records', () => {
  const cases = [
    value => { value.sourceCounts.project = 2; },
    value => { value.project.organizationId = 'org-other'; },
    value => { value.payment.stripeLivemode = true; },
    value => { value.proposal.projectId = 'project-other'; },
    value => { value.task.status = 'PENDING'; },
    value => { value.payment.settlementEvidenceStatus = 'PENDING'; },
    value => { value.report.generatedAt = new Date('2026-08-27T12:14:00.000Z'); },
    value => { value.invoice.deliveryAttempts = []; },
    value => { value.invoice.deliveryAttempts.push({ ...value.invoice.deliveryAttempts[0] }); },
  ];
  for (const mutate of cases) {
    const value = snapshot();
    mutate(value);
    assert.throws(() => build({ snapshot: value }));
  }
});

test('controlled journey evidence requires passing sandbox checks and bounded human attestation', () => {
  assert.throws(() => build({ sandboxReadiness: { ready: false, checks: [{ id: 'sandbox', ok: false }] } }), /sandbox readiness/);
  assert.throws(() => build({
    attestation: { noManualDatabaseCorrections: false, attestedBy: 'Cameron', reference: 'sandbox-run-1' },
  }), /attestation/);
});

test('controlled journey snapshot reads the completed project task and post-delivery client report in tenant scope', async () => {
  const value = snapshot();
  const calls = {};
  const prisma = {
    lead: { findFirst: async args => { calls.lead = args; return value.lead; } },
    client: { findFirst: async args => { calls.client = args; return value.client; } },
    pipelineDeal: { findFirst: async args => { calls.deal = args; return { ...value.deal, stage: { organizationId: 'org-1' } }; } },
    proposal: {
      findFirst: async args => { calls.proposal = args; return value.proposal; },
      count: async () => 1,
    },
    contract: {
      findFirst: async args => { calls.contract = args; return value.contract; },
      count: async () => 1,
    },
    project: {
      findFirst: async args => { calls.project = args; return value.project; },
      count: async () => 1,
    },
    task: { findMany: async args => { calls.task = args; return [value.task]; } },
    invoice: {
      findFirst: async args => { calls.invoice = args; return value.invoice; },
      count: async () => 1,
    },
    invoicePayment: { findMany: async args => { calls.payment = args; return [value.payment]; } },
    report: { findMany: async args => { calls.report = args; return [value.report]; } },
    leadEvent: { count: async () => 1 },
  };
  const result = await readControlledJourneySnapshot({ prisma, organizationId: 'org-1', leadId: 'lead-1' });
  assert.equal(result.task.id, 'task-1');
  assert.equal(result.report.id, 'report-1');
  assert.equal(result.sourceCounts.task, 1);
  assert.equal(result.sourceCounts.report, 1);
  assert.deepEqual(calls.lead.where, { id: 'lead-1', organizationId: 'org-1' });
  assert.deepEqual(calls.task.where, { projectId: 'project-1', deletedAt: null });
  assert.deepEqual(calls.report.where, { clientId: 'client-1' });
});

test('controlled journey exporter is tenant-scoped, read-only, explicit, and package-addressable', () => {
  const script = fs.readFileSync('scripts/export-controlled-journey-evidence.mjs', 'utf8');
  const service = fs.readFileSync('src/services/controlledJourneyEvidence.service.js', 'utf8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(script, /assessSandboxReadiness\(process\.env\)/);
  assert.match(script, /--attest-no-manual-db-corrections/);
  assert.match(script, /fs\.openSync\(output, 'wx', 0o600\)/);
  assert.match(service, /organizationId: organization/);
  assert.match(service, /stage: \{ organizationId: organization \}/);
  assert.match(service, /prisma\.task\.findMany/);
  assert.match(service, /prisma\.report\.findMany/);
  assert.doesNotMatch(service, /prisma\.[a-zA-Z]+\.(?:create|update|delete|upsert)/);
  assert.equal(
    packageJson.scripts['export:controlled-journey-evidence'],
    'node scripts/export-controlled-journey-evidence.mjs',
  );
});
