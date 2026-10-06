// Brand settings are per organization: BrandSettings.organizationId is unique
// (migration 20261001160000_estimate_tax_rate_brand_unique). Every read and
// write names the organization explicitly, so a lookup can never return or
// change another organization's branding, whichever Prisma client
// (request-scoped or raw) the caller holds.

/**
 * @param {any} db a Prisma client (request.prisma or the raw client)
 * @param {string} organizationId
 */
export async function findBrandSettings(db, organizationId) {
  if (!organizationId) throw new Error('organizationId is required to resolve brand settings');
  return db.brandSettings.findUnique({ where: { organizationId } });
}

/**
 * The organization's brand settings, created when it has none yet with the
 * organization's own name as the company name (the schema default for the
 * other fields). An upsert on the unique organizationId, so concurrent first
 * reads cannot create two rows. Existing rows are never changed here.
 * @param {any} db
 * @param {string} organizationId
 */
export async function getOrCreateBrandSettings(db, organizationId) {
  if (!organizationId) throw new Error('organizationId is required to resolve brand settings');
  const organization = db.organization?.findUnique
    ? await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } })
    : null;
  const companyName = typeof organization?.name === 'string' ? organization.name.trim() : '';
  try {
    return await db.brandSettings.upsert({
      where: { organizationId },
      create: { organizationId, ...(companyName && { companyName }) },
      update: {},
    });
  } catch (error) {
    // A concurrent first read created the row between Prisma's lookup and
    // insert (when it does not use INSERT ... ON CONFLICT): read the winner.
    if (error?.code === 'P2002') {
      const existing = await findBrandSettings(db, organizationId);
      if (existing) return existing;
    }
    throw error;
  }
}
