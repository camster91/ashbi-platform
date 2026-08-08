/**
 * Resolve the tenant set for a background job.
 *
 * Scheduled fleet-wide jobs enumerate organizations explicitly. Targeted
 * jobs must declare an organization and verify it before any scoped work.
 */
export async function resolveTenantOrganizationIds(prisma, requestedOrganizationId) {
  if (requestedOrganizationId) {
    const organization = await prisma.organization.findUnique({
      where: { id: requestedOrganizationId },
      select: { id: true },
    });
    if (!organization) {
      throw new Error(`Tenancy Error: unknown organization ${requestedOrganizationId}`);
    }
    return [organization.id];
  }

  const organizations = await prisma.organization.findMany({
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return organizations.map(({ id }) => id);
}
