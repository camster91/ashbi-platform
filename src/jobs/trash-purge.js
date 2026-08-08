// Trash purge cron job
// Runs daily at 04:00 to permanently delete items that have been in trash >30 days.

import prisma from '../config/db.js';
import { resolveTenantOrganizationIds, runTenantJob } from './tenant-iteration.js';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Map soft-delete enum to Prisma model delegate. We use the model API (not raw SQL)
// so Prisma parameterizes the query — no string interpolation, no SQL-injection surface.
// Adding a new entity here requires a corresponding model on the Prisma client.
const ENTITY_TO_MODEL = {
  CLIENT: 'client',
  PROJECT: 'project',
  INVOICE: 'invoice',
  PROPOSAL: 'proposal',
  CONTRACT: 'contract',
  EXPENSE: 'expense',
  TASK: 'task',
  ESTIMATE: 'estimate',
  NOTE: 'note',
  RETAINER_PLAN: 'retainerPlan',
};

async function purgeExpiredTrash(tenantPrisma) {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  console.log(`[trash-purge] Checking for expired items before ${cutoff.toISOString()}`);

  try {
    const expired = await tenantPrisma.trashedItem.findMany({
      where: {
        restoredAt: null,
        deletedAt: { lte: cutoff },
      },
    });

    if (expired.length === 0) {
      console.log('[trash-purge] No expired items');
      return;
    }

    console.log(`[trash-purge] Purging ${expired.length} expired item(s)`);

    // PERFORMANCE (audit 2026-07-09, swarm finding): the previous loop
    // issued 2 round-trips per item (entity delete + trashedItem delete).
    // For 50 trashed items that's 100 round-trips. Batch by entity type:
    //   1. Group expired by model delegate
    //   2. deleteMany per group (one round-trip per entity)
    //   3. deleteMany on trashedItem with `id: { in: expiredIds }` at the end
    const byModel = new Map();
    const errors = [];
    for (const item of expired) {
      const modelName = ENTITY_TO_MODEL[item.entity];
      if (!modelName || !tenantPrisma[modelName]) {
        errors.push({ item, reason: 'unknown entity' });
        continue;
      }
      if (!byModel.has(modelName)) byModel.set(modelName, []);
      byModel.get(modelName).push(item);
    }

    // Per-entity bulk delete. Failures here are logged and surfaced as
    // errors; the trashedItem rows for failed entity-deletes are still
    // removed so we don't retry them forever.
    for (const [modelName, items] of byModel) {
      const ids = items.map(i => i.recordId);
      try {
        await tenantPrisma[modelName].deleteMany({ where: { id: { in: ids } } });
      } catch (err) {
        console.error(`[trash-purge] Error in ${modelName} deleteMany:`, err.message);
        for (const item of items) errors.push({ item, reason: err.message });
      }
    }

    // Always remove trashedItem rows — successful ones (model gone) and
    // failed ones (mark as skipped, no retry).
    const allTrashedIds = expired.map(i => i.id);
    try {
      await tenantPrisma.trashedItem.deleteMany({ where: { id: { in: allTrashedIds } } });
    } catch (err) {
      console.error('[trash-purge] Error cleaning trashedItem rows:', err.message);
    }

    if (errors.length > 0) {
      console.warn(`[trash-purge] ${errors.length} item(s) had errors, see logs`);
    }
  } catch (err) {
    console.error('[trash-purge] Fatal error:', err);
  }
}

async function purgeExpiredTrashForAllOrganizations() {
  const organizationIds = await resolveTenantOrganizationIds(prisma);
  for (const organizationId of organizationIds) {
    await runTenantJob(prisma, organizationId, purgeExpiredTrash);
  }
}

export function startTrashPurgeJob() {
  console.log('[trash-purge] Scheduled daily at 04:00');

  const now = new Date();
  const next4am = new Date(now);
  next4am.setHours(4, 0, 0, 0);
  if (next4am <= now) next4am.setDate(next4am.getDate() + 1);

  const msUntil = next4am - now;

  setTimeout(() => {
    purgeExpiredTrashForAllOrganizations().catch(err =>
      console.error('[trash-purge] Scheduled run failed:', err)
    );
    setInterval(() => {
      purgeExpiredTrashForAllOrganizations().catch(err =>
        console.error('[trash-purge] Scheduled run failed:', err)
      );
    }, 24 * 60 * 60 * 1000); // daily
  }, msUntil);
}
