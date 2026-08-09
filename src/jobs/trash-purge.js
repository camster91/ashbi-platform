// Trash purge cron job. Runs daily at 04:00 and hard-deletes records whose
// recovery window has expired.

import { prisma, rawPrisma } from '../config/db.js';
import { permanentlyDeleteTrashedItem } from '../services/trash-purge.service.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeExpiredTrash(
  tenantPrisma,
  privilegedPrisma = rawPrisma,
  purgeOne = permanentlyDeleteTrashedItem,
) {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  console.log(`[trash-purge] Checking for expired items before ${cutoff.toISOString()}`);

  const expired = await tenantPrisma.trashedItem.findMany({
    where: {
      restoredAt: null,
      deletedAt: { lte: cutoff },
    },
  });

  if (expired.length === 0) {
    console.log('[trash-purge] No expired items');
    return { examined: 0, purged: 0, failed: 0 };
  }

  console.log(`[trash-purge] Purging ${expired.length} expired item(s)`);
  let purged = 0;
  let failed = 0;

  for (const item of expired) {
    try {
      await purgeOne({
        scopedPrisma: tenantPrisma,
        rawPrisma: privilegedPrisma,
        trashId: item.id,
      });
      purged++;
    } catch (error) {
      failed++;
      // Keep the ledger so a transient or configuration failure can retry.
      console.error(`[trash-purge] Retaining failed ledger ${item.id}:`, error.message);
    }
  }

  if (failed > 0) console.warn(`[trash-purge] ${failed} item(s) retained for retry`);
  return { examined: expired.length, purged, failed };
}

export async function purgeExpiredTrashForAllOrganizations() {
  const organizationIds = await resolveTenantOrganizationIds(prisma);
  const results = [];
  for (const organizationId of organizationIds) {
    results.push(await runTenantJob(
      prisma,
      organizationId,
      (tenantPrisma) => purgeExpiredTrash(tenantPrisma, rawPrisma),
      rawPrisma,
    ));
  }
  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  if (failed > 0) throw new Error(`${failed} trash purge item(s) retained for retry`);
  return { organizations: results };
}
