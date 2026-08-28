import { assessSandboxReadiness } from './sandbox-readiness.service.js';
import {
  buildControlledJourneyEvidence,
  readControlledJourneySnapshot,
} from './controlledJourneyEvidence.service.js';

export const CONTROLLED_JOURNEY_REQUIRED_MIGRATIONS = Object.freeze([
  '20260809023000_revenue_flow_integrity',
  '20260809223000_unique_invoice_per_proposal',
  '20260826173000_public_client_acquisition_intake',
  '20260826233000_pipeline_deal_currency',
  '20260826234500_lead_pipeline_promotion',
  '20260826235900_deal_proposal_currency',
  '20260827001000_invoice_creation_request_id',
  '20260827003000_stripe_checkout_attempt',
  '20260827005000_invoice_checkout_invalidation',
  '20260827009000_invoice_delivery_evidence',
  '20260827011000_stripe_settlement_evidence',
  '20260827016000_invoice_delivery_provider_events',
  '20260827020000_signed_contract_project_identity',
  '20260827021000_stripe_payment_mode_evidence',
  '20260828090000_report_generation_idempotency',
]);

const INSPECTION_ENVIRONMENT_CHECKS = new Set([
  'sandbox-flag',
  'environment-id',
  'target-url',
  'database-target',
  'synthetic-staff',
  'synthetic-client',
]);

function text(value) {
  return String(value ?? '').trim();
}

function check(id, ok, passMessage, failMessage, details) {
  return {
    id,
    ok: Boolean(ok),
    message: ok ? passMessage : failMessage,
    ...(details === undefined ? {} : { details }),
  };
}

function exactRevision(value) {
  return /^[a-f0-9]{7,40}$/i.test(text(value));
}

function boundedReference(value) {
  const normalized = text(value);
  return normalized.length >= 8 && normalized.length <= 200
    && !/pending|placeholder|todo|tbd/i.test(normalized);
}

function recordChainReasonCode(error) {
  const message = text(error?.message).toLowerCase();
  if (/missing or duplicate source writes/.test(message)) return 'SOURCE_WRITE_COUNT_MISMATCH';
  if (/stripe|settlement/.test(message)) return 'STRIPE_EVIDENCE_INCOMPLETE';
  if (/email/.test(message)) return 'EMAIL_EVIDENCE_INCOMPLETE';
  if (/currency/.test(message)) return 'CURRENCY_EVIDENCE_INCOMPLETE';
  if (/organization/.test(message)) return 'TENANT_BINDING_INCOMPLETE';
  for (const entity of ['lead', 'client', 'opportunity', 'proposal', 'contract', 'project', 'task', 'invoice', 'payment', 'report']) {
    if (message.includes(entity)) return `${entity.toUpperCase()}_EVIDENCE_INCOMPLETE`;
  }
  return 'RECORD_CHAIN_INCOMPLETE';
}

export function assessControlledJourneyPreflight({ environment = {}, input = {} } = {}) {
  const sandbox = assessSandboxReadiness(environment);
  const organizationId = text(input.organizationId);
  const configuredOrganizationId = text(environment.PUBLIC_INTAKE_ORGANIZATION_ID);
  const checks = [
    ...sandbox.checks,
    check(
      'organization-input',
      organizationId.length >= 3,
      'A bounded controlled-journey organization is provided.',
      'Provide the exact controlled-journey organization identifier.',
    ),
    check(
      'public-intake-organization-match',
      organizationId.length >= 3 && configuredOrganizationId === organizationId,
      'The controlled journey and public intake target the same organization.',
      'The controlled journey must use the exact configured public-intake organization.',
    ),
    check(
      'public-intake-owner',
      text(environment.PUBLIC_INTAKE_OWNER_USER_ID).length >= 3,
      'A public-intake owner is configured for target inspection.',
      'Configure the exact active public-intake owner.',
    ),
    check(
      'controlled-lead-input',
      text(input.leadId).length >= 3,
      'A synthetic controlled-journey lead is provided.',
      'Provide the completed synthetic sandbox lead identifier.',
    ),
    check(
      'public-revision-input',
      exactRevision(input.publicSiteRevision),
      'An exact public-site Git revision is provided.',
      'Provide the exact deployed public-site Git revision.',
    ),
    check(
      'hub-revision-input',
      exactRevision(input.hubRevision),
      'An exact Hub Git revision is provided.',
      'Provide the exact deployed Hub Git revision.',
    ),
    check(
      'attested-by-input',
      text(input.attestedBy).length >= 2 && text(input.attestedBy).length <= 100,
      'A bounded human attester is provided.',
      'Provide the human attester for the no-manual-correction statement.',
    ),
    check(
      'attestation-reference-input',
      boundedReference(input.attestationReference),
      'A bounded non-placeholder attestation reference is provided.',
      'Provide the final no-manual-correction attestation reference after the run.',
    ),
  ];
  const environmentInspectable = checks
    .filter(item => INSPECTION_ENVIRONMENT_CHECKS.has(item.id))
    .every(item => item.ok);
  const identityInspectable = organizationId.length >= 3
    && configuredOrganizationId === organizationId
    && text(environment.PUBLIC_INTAKE_OWNER_USER_ID).length >= 3;
  return {
    ready: false,
    inspected: false,
    inspectable: environmentInspectable && identityInspectable,
    checks,
  };
}

export async function inspectControlledJourneyTarget({
  environment = {},
  input = {},
  prisma,
  readSnapshot = readControlledJourneySnapshot,
  buildEvidence = buildControlledJourneyEvidence,
} = {}) {
  const preflight = assessControlledJourneyPreflight({ environment, input });
  if (!preflight.inspectable) return preflight;

  try {
    const migrations = await prisma.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at
      FROM "_prisma_migrations"
    `;
    const applied = new Set((migrations ?? [])
      .filter(migration => migration.finished_at && !migration.rolled_back_at)
      .map(migration => migration.migration_name));
    const missingMigrations = CONTROLLED_JOURNEY_REQUIRED_MIGRATIONS.filter(name => !applied.has(name));
    const organizationId = text(input.organizationId);
    const ownerId = text(environment.PUBLIC_INTAKE_OWNER_USER_ID);
    const syntheticStaffEmail = text(environment.ASHBI_SANDBOX_STAFF_EMAIL).toLowerCase();
    const syntheticClientEmail = text(environment.ASHBI_SANDBOX_CLIENT_EMAIL).toLowerCase();
    const [organization, owner, client] = await Promise.all([
      prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }),
      prisma.user.findFirst({
        where: {
          id: ownerId,
          organizationId,
          email: syntheticStaffEmail,
          isActive: true,
          role: { in: ['ADMIN', 'TEAM'] },
        },
        select: { id: true },
      }),
      prisma.client.findFirst({
        where: {
          organizationId,
          email: syntheticClientEmail,
          deletedAt: null,
        },
        select: { id: true },
      }),
    ]);
    const checks = [
      ...preflight.checks,
      check(
        'required-migrations',
        missingMigrations.length === 0,
        'Every controlled-journey migration is finished and active.',
        'One or more controlled-journey migrations are missing, unfinished, or rolled back.',
        { missingMigrations },
      ),
      check(
        'organization-exists',
        Boolean(organization),
        'The target organization exists.',
        'The target organization was not found.',
      ),
      check(
        'owner-active-synthetic-staff',
        Boolean(owner),
        'The configured owner is the active synthetic staff identity in the target organization.',
        'The configured owner is not the active synthetic staff identity in the target organization.',
      ),
      check(
        'synthetic-client-exists',
        Boolean(client),
        'The synthetic client exists in the target organization.',
        'The synthetic client was not found in the target organization.',
      ),
    ];

    let recordChainOk = false;
    let recordChainReason = 'Provide the completed synthetic sandbox lead identifier.';
    let recordChainCode = 'LEAD_INPUT_REQUIRED';
    if (text(input.leadId).length >= 3 && organization && owner && client && missingMigrations.length === 0) {
      try {
        const snapshot = await readSnapshot({ prisma, organizationId, leadId: text(input.leadId) });
        buildEvidence({
          organizationId,
          publicSiteRevision: exactRevision(input.publicSiteRevision) ? input.publicSiteRevision : 'abcdef1',
          hubRevision: exactRevision(input.hubRevision) ? input.hubRevision : 'abcdef2',
          snapshot,
          sandboxReadiness: { ready: true, checks: [{ id: 'record-chain-preflight', ok: true }] },
          attestation: {
            noManualDatabaseCorrections: true,
            attestedBy: text(input.attestedBy) || 'Preflight operator',
            reference: boundedReference(input.attestationReference)
              ? input.attestationReference
              : 'preflight-validation-only',
          },
        });
        recordChainOk = true;
        recordChainReason = 'The existing synthetic record chain reconciles without producing evidence.';
        recordChainCode = 'RECORD_CHAIN_READY';
      } catch (error) {
        recordChainReason = 'The synthetic record chain is incomplete or inconsistent.';
        recordChainCode = recordChainReasonCode(error);
      }
    }
    checks.push(check(
      'record-chain-ready',
      recordChainOk,
      recordChainReason,
      recordChainReason,
      { reasonCode: recordChainCode },
    ));
    return {
      ready: checks.every(item => item.ok),
      inspected: true,
      inspectable: true,
      checks,
    };
  } catch {
    return {
      ready: false,
      inspected: true,
      inspectable: true,
      checks: [
        ...preflight.checks,
        check(
          'target-inspection',
          false,
          'The target inspection completed.',
          'The named sandbox database could not be inspected safely.',
        ),
      ],
    };
  }
}
