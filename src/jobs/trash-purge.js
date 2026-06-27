// Trash purge cron job
// Runs daily at 04:00 to permanently delete items that have been in trash >30 days.

import prisma from '../config/db.js';

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

async function purgeExpiredTrash() {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  console.log(`[trash-purge] Checking for expired items before ${cutoff.toISOString()}`);

  try {
    const expired = await prisma.trashedItem.findMany({
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

    for (const item of expired) {
      try {
        const modelName = ENTITY_TO_MODEL[item.entity];
        const delegate = modelName && prisma[modelName];
        if (delegate) {
          // Use model API — Prisma parameterizes via prepared statement.
          await delegate.delete({ where: { id: item.recordId } });
        }
        await prisma.trashedItem.delete({ where: { id: item.id } });
        console.log(`[trash-purge] Purged ${item.entity} ${item.recordId}`);
      } catch (err) {
        console.error(`[trash-purge] Error purging ${item.entity} ${item.recordId}:`, err.message);
        // Still delete trashedItem so it doesn't retry forever
        try {
          await prisma.trashedItem.delete({ where: { id: item.id } });
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error('[trash-purge] Fatal error:', err);
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
    purgeExpiredTrash();
    setInterval(purgeExpiredTrash, 24 * 60 * 60 * 1000); // daily
  }, msUntil);
}
