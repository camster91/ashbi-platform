// Deal Pipeline service - CRM deal management
// Migrated from ashbi-hub raw SQL to Prisma

import prisma from '../config/db.js';

/**
 * Get all pipeline stages with their deals
 */
export async function getPipelineStages() {
  return prisma.pipelineStage.findMany({
    orderBy: { order: 'asc' },
    include: {
      deals: {
        include: {
          client: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: 'desc' }
      }
    }
  });
}

/**
 * Create a new pipeline stage
 */
export async function createStage(data) {
  const { name, color, probability, order } = data;

  return prisma.pipelineStage.create({
    data: {
      name,
      color: color || '#3B82F6',
      probability: probability || 0,
      order: order ?? 0
    }
  });
}

/**
 * Update a pipeline stage
 */
export async function updateStage(stageId, data) {
  return prisma.pipelineStage.update({
    where: { id: stageId },
    data
  });
}

/**
 * Delete a pipeline stage and optionally reassign its deals
 */
export async function deleteStage(stageId, moveToStageId) {
  if (moveToStageId) {
    await prisma.pipelineDeal.updateMany({
      where: { stageId },
      data: { stageId: moveToStageId }
    });
  }

  return prisma.pipelineStage.delete({
    where: { id: stageId }
  });
}

/**
 * Create a new deal
 */
export async function createDeal(data) {
  const { title, value, clientId, stageId, probability, expectedCloseDate, notes, contactPerson, source } = data;

  return prisma.pipelineDeal.create({
    data: {
      title,
      value: value || 0,
      clientId,
      stageId,
      probability: probability || 0,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      notes,
      contactPerson,
      source
    },
    include: {
      client: { select: { id: true, name: true } },
      stage: true
    }
  });
}

/**
 * Update a deal (move between stages, update value, etc.)
 */
export async function updateDeal(dealId, data) {
  return prisma.pipelineDeal.update({
    where: { id: dealId },
    data,
    include: {
      client: { select: { id: true, name: true } },
      stage: true
    }
  });
}

/**
 * Delete a deal
 */
export async function deleteDeal(dealId) {
  return prisma.pipelineDeal.delete({
    where: { id: dealId }
  });
}

/**
 * Get pipeline analytics
 */
export async function getPipelineAnalytics() {
  const stages = await prisma.pipelineStage.findMany({
    orderBy: { order: 'asc' },
    include: {
      _count: { select: { deals: true } }
    }
  });

  const totalValue = await prisma.pipelineDeal.aggregate({
    _sum: { value: true },
    _avg: { probability: true }
  });

  const dealsByStage = await prisma.pipelineDeal.groupBy({
    by: ['stageId'],
    _sum: { value: true },
    _count: true
  });

  const wonDeals = await prisma.pipelineDeal.count({
    where: { probability: { gte: 100 } }
  });

  const totalDeals = await prisma.pipelineDeal.count();

  return {
    stages,
    totalPipelineValue: totalValue._sum.value || 0,
    averageWinProbability: totalValue._avg.probability || 0,
    dealsByStage,
    wonDeals,
    totalDeals,
    winRate: totalDeals > 0 ? (wonDeals / totalDeals) * 100 : 0
  };
}