// Brand settings are per organization (BrandSettings.organizationId). Every
// read and write names the organization explicitly, so a lookup can never
// return or change another organization's branding, whichever Prisma client
// (request-scoped or raw) the caller holds.
//
// organizationId is indexed but not unique, so this is find-or-create rather
// than an upsert; the oldest row (lowest id) wins if duplicates exist.

/**
 * @param {any} db a Prisma client (request.prisma or the raw client)
 * @param {string} organizationId
 */
export async function findBrandSettings(db, organizationId) {
  if (!organizationId) throw new Error('organizationId is required to resolve brand settings');
  return db.brandSettings.findFirst({ where: { organizationId }, orderBy: { id: 'asc' } });
}

/**
 * The organization's brand settings, created with the schema defaults when
 * it has none yet.
 * @param {any} db
 * @param {string} organizationId
 */
export async function getOrCreateBrandSettings(db, organizationId) {
  const existing = await findBrandSettings(db, organizationId);
  if (existing) return existing;
  return db.brandSettings.create({ data: { organizationId } });
}
