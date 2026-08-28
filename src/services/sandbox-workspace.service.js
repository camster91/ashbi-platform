import { assessSandboxReadiness } from './sandbox-readiness.service.js';

const EXPECTED = Object.freeze({
  staffName: 'Synthetic Sandbox Staff',
  clientName: 'Synthetic Sandbox Client',
  contactName: 'Synthetic Sandbox Contact',
  projectName: 'Synthetic Commercial Journey',
});

function text(value) {
  return String(value ?? '').trim();
}

function resultCheck(id, ok, passMessage, failMessage) {
  return { id, ok: Boolean(ok), message: ok ? passMessage : failMessage };
}

function safeSlug(value) {
  const slug = text(value).toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    && /sandbox|staging|test/.test(slug)
    && !/production|(^|-)prod($|-)|live/.test(slug);
}

function workspaceSpec(environment) {
  const environmentId = text(environment.ASHBI_SANDBOX_ENVIRONMENT_ID).toLowerCase();
  return {
    organizationSlug: text(environment.ASHBI_SANDBOX_ORGANIZATION_SLUG).toLowerCase(),
    organizationName: `Ashbi Sandbox — ${environmentId}`,
    staffEmail: text(environment.ASHBI_SANDBOX_STAFF_EMAIL).toLowerCase(),
    clientEmail: text(environment.ASHBI_SANDBOX_CLIENT_EMAIL).toLowerCase(),
    ...EXPECTED,
  };
}

async function inspectWorkspace(prisma, spec) {
  const organization = await prisma.organization.findUnique({
    where: { slug: spec.organizationSlug },
  });
  const staff = await prisma.user.findUnique({ where: { email: spec.staffEmail } });

  let client = null;
  let contact = null;
  let project = null;
  if (organization) {
    client = await prisma.client.findFirst({
      where: { organizationId: organization.id, email: spec.clientEmail },
    });
    if (client) {
      contact = await prisma.contact.findUnique({
        where: { email_clientId: { email: spec.clientEmail, clientId: client.id } },
      });
    }
    project = await prisma.project.findFirst({
      where: { organizationId: organization.id, name: spec.projectName },
    });
  }

  const conflicts = [];
  if (organization && organization.name !== spec.organizationName) conflicts.push('organization-name');
  if (staff && (
    staff.organizationId !== organization?.id
    || staff.name !== spec.staffName
    || staff.role !== 'ADMIN'
  )) conflicts.push('staff-identity');
  if (client && client.name !== spec.clientName) conflicts.push('client-identity');
  if (contact && (contact.name !== spec.contactName || contact.isPrimary !== true)) conflicts.push('contact-identity');
  if (project && project.clientId !== client?.id) conflicts.push('project-client');

  return { organization, staff, client, contact, project, conflicts };
}

function actionsFromSnapshot(snapshot) {
  return [
    ['organization', snapshot.organization],
    ['staff', snapshot.staff],
    ['client', snapshot.client],
    ['contact', snapshot.contact],
    ['project', snapshot.project],
  ].map(([entity, record]) => ({ entity, operation: record ? 'REUSE' : 'CREATE' }));
}

async function applyWorkspace({ prisma, snapshot, spec, password, hashPassword }) {
  return prisma.$transaction(async (tx) => {
    const organization = snapshot.organization || await tx.organization.create({
      data: { name: spec.organizationName, slug: spec.organizationSlug, plan: 'FREE' },
    });
    const staff = snapshot.staff || await tx.user.create({
      data: {
        organizationId: organization.id,
        email: spec.staffEmail,
        name: spec.staffName,
        password: await hashPassword(password),
        role: 'ADMIN',
        skills: '[]',
        capacity: 100,
        hourlyRate: null,
      },
    });
    const client = snapshot.client || await tx.client.create({
      data: {
        organizationId: organization.id,
        name: spec.clientName,
        email: spec.clientEmail,
        country: 'CA',
        relationshipStatus: 'LEAD',
        serviceType: 'sandbox_validation',
      },
    });
    const contact = snapshot.contact || await tx.contact.create({
      data: {
        clientId: client.id,
        email: spec.clientEmail,
        name: spec.contactName,
        role: 'Synthetic client',
        isPrimary: true,
      },
    });
    const project = snapshot.project || await tx.project.create({
      data: {
        organizationId: organization.id,
        clientId: client.id,
        name: spec.projectName,
        description: 'Synthetic, non-production workspace for the controlled proposal-to-payment validation journey.',
        serviceType: 'sandbox_validation',
        defaultOwnerId: staff.id,
      },
    });
    return { organization, staff, client, contact, project };
  });
}

export async function bootstrapSandboxWorkspace({
  prisma,
  environment = {},
  confirm = false,
  hashPassword,
}) {
  const providerReadiness = assessSandboxReadiness(environment);
  const readinessById = new Map(providerReadiness.checks.map((item) => [item.id, item]));
  const workspaceTargetReady = [
    'sandbox-flag',
    'environment-id',
    'target-url',
    'database-target',
    'synthetic-staff',
    'synthetic-client',
  ].every((id) => readinessById.get(id)?.ok);
  const mutationAuthorized = !confirm || [
    'backup-reference',
    'approval-reference',
  ].every((id) => readinessById.get(id)?.ok);
  const spec = workspaceSpec(environment);
  const password = text(environment.ASHBI_SANDBOX_STAFF_PASSWORD);
  const slugMatchesEnvironment = spec.organizationSlug === text(environment.ASHBI_SANDBOX_ENVIRONMENT_ID).toLowerCase();
  const checks = [
    resultCheck(
      'sandbox-readiness',
      workspaceTargetReady,
      'The named non-production workspace target and synthetic identities passed preflight.',
      'The named non-production workspace target and synthetic identities must pass preflight.',
    ),
    resultCheck(
      'organization-slug',
      safeSlug(spec.organizationSlug) && slugMatchesEnvironment,
      'The workspace slug exactly identifies the named non-production environment.',
      'Use an explicit sandbox, staging, or test slug that exactly matches the environment identifier.',
    ),
    resultCheck(
      'mutation-authorization',
      mutationAuthorized,
      confirm ? 'The backup and action-time approval references are recorded.' : 'No mutation authorization is needed for a dry run.',
      'Record the verified backup and Cameron’s exact action-time approval before confirmation.',
    ),
    resultCheck(
      'staff-password',
      !confirm || password.length >= 16,
      confirm ? 'A sufficiently long synthetic staff password is configured.' : 'No password is needed for a dry run.',
      'Configure a synthetic staff password of at least 16 characters for confirmation.',
    ),
  ];

  if (!checks.every((item) => item.ok)) {
    return { ready: false, confirmed: false, checks, actions: [] };
  }

  const snapshot = await inspectWorkspace(prisma, spec);
  checks.push(resultCheck(
    'record-conflicts',
    snapshot.conflicts.length === 0,
    'Existing synthetic records match the bounded workspace identity.',
    'Existing records conflict with the bounded synthetic workspace; review them manually.',
  ));
  const actions = actionsFromSnapshot(snapshot);
  if (!checks.every((item) => item.ok)) {
    return { ready: false, confirmed: false, checks, actions };
  }

  if (!confirm) return { ready: true, confirmed: false, checks, actions };
  if (typeof hashPassword !== 'function') {
    return {
      ready: false,
      confirmed: false,
      checks: [...checks, resultCheck('password-hasher', false, '', 'Password hashing is unavailable.')],
      actions,
    };
  }

  const records = await applyWorkspace({ prisma, snapshot, spec, password, hashPassword });
  return {
    ready: true,
    confirmed: true,
    checks,
    actions,
    recordIds: {
      organizationId: records.organization.id,
      staffUserId: records.staff.id,
      clientId: records.client.id,
      contactId: records.contact.id,
      projectId: records.project.id,
    },
  };
}
