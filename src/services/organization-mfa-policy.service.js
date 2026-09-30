// Organization MFA requirement: read and change (#416 follow-up).
// Enforcement lives in src/auth/mfa-enforcement.js; policy in
// docs/privileged-actions.md#organization-mfa-requirement.

import { isMfaRequired, MFA_INELIGIBLE_ROLES } from '../auth/mfa.js';
import { MFA_SELF_ENROLLMENT_REQUIRED_CODE } from '../auth/mfa-enforcement.js';
import { recordRequestAuditEvent } from './audit-event.service.js';

export class MfaPolicyError extends Error {
  /** @param {string} code @param {string} message @param {number} status */
  constructor(code, message, status) {
    super(message);
    this.name = 'MfaPolicyError';
    this.code = code;
    this.status = status;
  }
}

/** Active staff members of the organization who have not enrolled. */
async function countStaffWithoutMfa(prisma, organizationId) {
  return prisma.user.count({
    where: {
      organizationId,
      isActive: true,
      role: { notIn: [...MFA_INELIGIBLE_ROLES] },
      OR: [{ mfaEnabled: false }, { mfaSecret: null }],
    },
  });
}

async function loadActor(prisma, userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, mfaEnabled: true, mfaSecret: true },
  });
}

/**
 * The organization's requirement, how many staff still have to enroll, and
 * whether the acting admin has two-factor on (enabling needs it).
 * @param {any} prisma tenant-scoped or raw client
 * @param {{ organizationId: string, actorUserId: string }} input
 */
export async function getOrganizationMfaPolicy(prisma, { organizationId, actorUserId }) {
  const [organization, staffWithoutMfa, actor] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { mfaRequired: true } }),
    countStaffWithoutMfa(prisma, organizationId),
    loadActor(prisma, actorUserId),
  ]);
  return {
    required: organization?.mfaRequired === true,
    staffWithoutMfa,
    actorMfaEnabled: isMfaRequired(actor),
  };
}

/**
 * Turn the requirement on or off for the acting admin's organization.
 *
 * Turning it on is refused (409 MFA_SELF_ENROLLMENT_REQUIRED) unless the
 * acting admin has two-factor on, so they can never lock themselves into the
 * enrollment-only session by their own change. The update is conditional on
 * the current value, so exactly one audit event is written per real change
 * even when two admins submit at once; a no-op change writes none.
 *
 * @param {any} prisma tenant-scoped client of the request
 * @param {any} request the authenticated admin request (for audit context)
 * @param {{ organizationId: string, actorUserId: string, required: boolean }} input
 */
export async function setOrganizationMfaRequirement(prisma, request, { organizationId, actorUserId, required }) {
  if (required) {
    const actor = await loadActor(prisma, actorUserId);
    if (!isMfaRequired(actor)) {
      throw new MfaPolicyError(
        MFA_SELF_ENROLLMENT_REQUIRED_CODE,
        'Turn on two-factor authentication for your own account before requiring it for everyone.',
        409,
      );
    }
  }

  const changed = await prisma.organization.updateMany({
    where: { id: organizationId, mfaRequired: !required },
    data: { mfaRequired: required },
  });

  const policy = await getOrganizationMfaPolicy(prisma, { organizationId, actorUserId });
  if (changed.count === 1) {
    await recordRequestAuditEvent(prisma, request, {
      organizationId,
      actorUserId,
      actorType: 'USER',
      action: 'organization.mfa_requirement_changed',
      entityId: organizationId,
      metadata: { fromRequired: !required, toRequired: required, staffWithoutMfa: policy.staffWithoutMfa },
    });
  }
  return { ...policy, changed: changed.count === 1 };
}
