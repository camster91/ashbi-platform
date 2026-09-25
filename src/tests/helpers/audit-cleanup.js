// Test-only teardown for organizations that may have audit history.
//
// audit_events is append-only (row and TRUNCATE triggers) and its
// organization FK is ON DELETE RESTRICT, so a fixture organization that
// accumulated audit rows can no longer be deleted by a test's normal
// teardown. A superuser may suspend triggers for the length of one
// transaction with session_replication_role = replica; this helper does that
// only to remove the fixture's own audit rows, then the caller deletes the
// organization with foreign keys enforced as usual.
//
// Never use this outside tests: production roles must not be superusers, and
// the append-only guarantee depends on that.

/**
 * @param {any} prisma A Prisma client (raw, not request-scoped).
 * @param {{ ids?: string[], slugs?: string[] }} organizations
 * @returns {Promise<boolean>} false when the role cannot suspend triggers
 *   (the audit rows, and therefore the organizations, are then left behind).
 */
export async function purgeFixtureAuditEvents(prisma, { ids = [], slugs = [] } = {}) {
  const organizationIds = ids.filter(Boolean);
  const organizationSlugs = slugs.filter(Boolean);
  if (organizationIds.length === 0 && organizationSlugs.length === 0) return true;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.$executeRawUnsafe(
        `DELETE FROM "audit_events"
          WHERE "organizationId" = ANY($1::text[])
             OR "organizationId" IN (SELECT "id" FROM "organizations" WHERE "slug" = ANY($2::text[]))`,
        organizationIds,
        organizationSlugs,
      );
    });
    return true;
  } catch (error) {
    console.warn(`[test cleanup] audit events for fixture organizations were not purged: ${error.message}`);
    return false;
  }
}
