// Deal Pipeline service - CRM deal management
//
// Every function takes the request's organization-scoped Prisma client
// (`request.prisma`, see src/utils/prisma-tenant-proxy.js) as its first
// argument. PipelineStage is scoped directly by organizationId; PipelineDeal
// is scoped through its required client, and the proxy verifies that every
// clientId/stageId a write names belongs to the same organization.
//
// Field names follow the Prisma PipelineDeal model: `title`, `value`,
// `clientId` (required), `stageId` (required).

/** Stages a new organization starts with, in board order. */
export const DEFAULT_PIPELINE_STAGES = Object.freeze([
  Object.freeze({ name: 'Lead', order: 0, color: '#8B5CF6', probability: 10 }),
  Object.freeze({ name: 'Qualified', order: 1, color: '#3B82F6', probability: 25 }),
  Object.freeze({ name: 'Proposal', order: 2, color: '#06B6D4', probability: 50 }),
  Object.freeze({ name: 'Negotiation', order: 3, color: '#F59E0B', probability: 75 }),
  Object.freeze({ name: 'Won', order: 4, color: '#10B981', probability: 100 }),
]);

export class PipelineError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = 'PipelineError';
    this.statusCode = statusCode;
  }
}

/** Advisory-lock key serialising one organization's default-stage seeding. */
export function stageSeedLockKey(organizationId) {
  return `pipeline-stage-seed:${organizationId}`;
}

const DEAL_INCLUDE = {
  client: { select: { id: true, name: true } },
  stage: true,
};

// Deals of a soft-deleted client stay in the table (they come back if the
// client is restored) but are left off the board and out of the totals.
const LIVE_DEAL_WHERE = Object.freeze({ client: { deletedAt: null } });

function listStagesWithDeals(db) {
  return db.pipelineStage.findMany({
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: {
      deals: {
        where: LIVE_DEAL_WHERE,
        include: { client: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
}

/**
 * Give an organization the default stages the first time its pipeline is
 * read. Idempotent and race-safe: concurrent first reads serialise on a
 * per-organization advisory lock, and only the first one, which still finds
 * no stages after taking the lock, creates them. An organization that has
 * created (or kept) any stage of its own is never re-seeded.
 *
 * Intentional: an organization that deletes every stage gets the defaults
 * back on its next read, since a pipeline with no stage cannot hold a deal.
 *
 * The counts name the organization explicitly, so this is also correct with
 * an unscoped client (background automation).
 *
 * @returns {Promise<boolean>} true when this call created the defaults
 */
export async function ensureDefaultStages(db, organizationId) {
  if (!organizationId) throw new PipelineError('Organization context required', 403);
  const existing = await db.pipelineStage.count({ where: { organizationId } });
  if (existing > 0) return false;

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${stageSeedLockKey(organizationId)}, 0))`;
    const count = await tx.pipelineStage.count({ where: { organizationId } });
    if (count > 0) return false;
    await tx.pipelineStage.createMany({
      data: DEFAULT_PIPELINE_STAGES.map((stage) => ({ ...stage, organizationId })),
    });
    return true;
  });
}

/**
 * Get all pipeline stages with their deals, seeding the defaults for an
 * organization that has none yet.
 */
export async function getPipelineStages(db, organizationId) {
  await ensureDefaultStages(db, organizationId);
  return listStagesWithDeals(db);
}

/**
 * Create a new pipeline stage
 */
export async function createStage(db, data) {
  const { name, color, probability, order } = data;

  return db.pipelineStage.create({
    data: {
      name,
      color: color || '#3B82F6',
      probability: probability ?? 0,
      order: order ?? 0,
    },
  });
}

/**
 * Update a pipeline stage
 */
export async function updateStage(db, stageId, data) {
  return db.pipelineStage.update({
    where: { id: stageId },
    data,
  });
}

/**
 * Delete a pipeline stage, moving its deals to `moveToStageId` first. A stage
 * that still holds deals cannot be deleted without a destination.
 */
export async function deleteStage(db, stageId, moveToStageId) {
  if (moveToStageId === stageId) {
    throw new PipelineError('Deals cannot be moved to the stage being deleted', 400);
  }
  // One transaction, so a deal created in the stage meanwhile can neither be
  // stranded nor block the delete half-way.
  return db.$transaction(async (tx) => {
    const stage = await tx.pipelineStage.findFirst({ where: { id: stageId }, select: { id: true } });
    if (!stage) throw new PipelineError('Stage not found', 404);

    if (moveToStageId) {
      const target = await tx.pipelineStage.findFirst({ where: { id: moveToStageId }, select: { id: true, probability: true } });
      if (!target) throw new PipelineError('Destination stage not found', 404);
      await tx.pipelineDeal.updateMany({
        where: { stageId },
        data: { stageId: moveToStageId, probability: target.probability },
      });
    } else {
      const remaining = await tx.pipelineDeal.count({ where: { stageId } });
      if (remaining > 0) {
        throw new PipelineError('Move this stage\'s deals to another stage before deleting it', 409);
      }
    }

    return tx.pipelineStage.delete({
      where: { id: stageId },
    });
  });
}

/** The win probability of `stageId`, or a 404 when it is not this organization's. */
async function stageProbability(db, stageId) {
  const stage = await db.pipelineStage.findFirst({ where: { id: stageId }, select: { probability: true } });
  if (!stage) throw new PipelineError('Stage not found', 404);
  return stage.probability;
}

/**
 * Create a new deal. Its probability is the stage's unless one is given.
 */
export async function createDeal(db, data) {
  const { title, value, clientId, stageId, probability, expectedCloseDate, notes, contactPerson, source } = data;
  const dealProbability = probability ?? await stageProbability(db, stageId);

  return db.pipelineDeal.create({
    data: {
      title,
      value: value ?? 0,
      clientId,
      stageId,
      probability: dealProbability,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes,
      contactPerson,
      source,
    },
    include: DEAL_INCLUDE,
  });
}

/**
 * Update a deal (move between stages, update value, etc.). Moving a deal to
 * another stage takes that stage's probability unless one is given.
 */
export async function updateDeal(db, dealId, data) {
  const next = { ...data };
  if (next.expectedCloseDate !== undefined) {
    next.expectedCloseDate = next.expectedCloseDate ? new Date(next.expectedCloseDate) : null;
  }
  if (next.stageId && next.probability === undefined) {
    next.probability = await stageProbability(db, next.stageId);
  }
  return db.pipelineDeal.update({
    where: { id: dealId },
    data: next,
    include: DEAL_INCLUDE,
  });
}

/**
 * The stage an approved proposal's deal belongs in: the organization's won
 * stage (probability 100), else its last stage. Seeds the defaults first, so
 * an organization that never opened the pipeline still gets the deal.
 */
export async function wonStageFor(db, organizationId) {
  await ensureDefaultStages(db, organizationId);
  const won = await db.pipelineStage.findFirst({
    where: { organizationId, probability: 100 },
    orderBy: [{ order: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, probability: true },
  });
  if (won) return won;
  return db.pipelineStage.findFirst({
    where: { organizationId },
    orderBy: [{ order: 'desc' }, { createdAt: 'desc' }],
    select: { id: true, probability: true },
  });
}

/**
 * Delete a deal
 */
export async function deleteDeal(db, dealId) {
  return db.pipelineDeal.delete({
    where: { id: dealId },
  });
}

/**
 * Get pipeline analytics
 */
export async function getPipelineAnalytics(db) {
  const [stages, totalValue, dealsByStage, wonDeals, totalDeals] = await Promise.all([
    db.pipelineStage.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { deals: { where: LIVE_DEAL_WHERE } } },
      },
    }),
    db.pipelineDeal.aggregate({
      where: LIVE_DEAL_WHERE,
      _sum: { value: true },
      _avg: { probability: true },
    }),
    db.pipelineDeal.groupBy({
      by: ['stageId'],
      where: LIVE_DEAL_WHERE,
      _sum: { value: true },
      _count: true,
    }),
    db.pipelineDeal.count({
      where: { ...LIVE_DEAL_WHERE, probability: { gte: 100 } },
    }),
    db.pipelineDeal.count({ where: LIVE_DEAL_WHERE }),
  ]);

  return {
    stages,
    totalPipelineValue: totalValue._sum.value || 0,
    averageWinProbability: totalValue._avg.probability || 0,
    dealsByStage,
    wonDeals,
    totalDeals,
    winRate: totalDeals > 0 ? (wonDeals / totalDeals) * 100 : 0,
  };
}
