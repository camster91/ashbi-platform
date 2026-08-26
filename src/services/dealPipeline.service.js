// Deal pipeline service. Every operation receives the request-scoped Prisma
// client so pipeline data cannot escape the authenticated organization.

export class PipelineError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'PipelineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function assertStage(prisma, stageId) {
  const stage = await prisma.pipelineStage.findFirst({
    where: { id: stageId },
    select: { id: true },
  });
  if (!stage) {
    throw new PipelineError('Pipeline stage not found', 'PIPELINE_STAGE_NOT_FOUND', 404);
  }
  return stage;
}

function shapeDeal(deal) {
  return {
    id: deal.id,
    title: deal.title,
    name: deal.title,
    value: deal.value,
    total: deal.value,
    clientId: deal.client.id,
    clientName: deal.client.name,
  };
}

function shapeStage(stage) {
  const items = stage.deals.map(shapeDeal);
  return {
    id: stage.id,
    key: stage.id,
    label: stage.name,
    name: stage.name,
    order: stage.order,
    color: stage.color,
    probability: stage.probability,
    count: items.length,
    value: items.reduce((sum, deal) => sum + (Number(deal.value) || 0), 0),
    items,
  };
}

export async function getPipelineStages(prisma) {
  const stages = await prisma.pipelineStage.findMany({
    orderBy: { order: 'asc' },
    include: {
      deals: {
        include: { client: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  return stages.map(shapeStage);
}

export async function createStage(prisma, data) {
  const { name, color, probability, order } = data;
  return prisma.pipelineStage.create({
    data: {
      name,
      color: color ?? '#3B82F6',
      probability: probability ?? 0,
      order: order ?? 0,
    },
  });
}

export async function updateStage(prisma, stageId, data) {
  await assertStage(prisma, stageId);
  return prisma.pipelineStage.update({ where: { id: stageId }, data });
}

export async function deleteStage(prisma, stageId, moveToStageId) {
  await assertStage(prisma, stageId);
  if (moveToStageId === stageId) {
    throw new PipelineError('A stage cannot be moved into itself', 'PIPELINE_STAGE_CONFLICT', 409);
  }
  if (moveToStageId) await assertStage(prisma, moveToStageId);

  return prisma.$transaction(async (transaction) => {
    if (moveToStageId) {
      await transaction.pipelineDeal.updateMany({
        where: { stageId },
        data: { stageId: moveToStageId },
      });
    } else {
      const dealCount = await transaction.pipelineDeal.count({ where: { stageId } });
      if (dealCount > 0) {
        throw new PipelineError(
          'Move this stage\'s deals before deleting it',
          'PIPELINE_STAGE_NOT_EMPTY',
          409,
        );
      }
    }
    return transaction.pipelineStage.delete({ where: { id: stageId } });
  });
}

export async function createDeal(prisma, data) {
  await assertStage(prisma, data.stageId);
  return prisma.pipelineDeal.create({
    data: {
      title: data.name,
      clientId: data.clientId,
      stageId: data.stageId,
      value: data.value ?? 0,
      ...(data.expectedCloseDate !== undefined && {
        expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
      }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
    include: {
      client: { select: { id: true, name: true } },
      stage: true,
    },
  });
}

export async function updateDeal(prisma, dealId, data) {
  if (data.stageId) await assertStage(prisma, data.stageId);
  const update = {
    ...(data.name !== undefined && { title: data.name }),
    ...(data.stageId !== undefined && { stageId: data.stageId }),
    ...(data.value !== undefined && { value: data.value }),
    ...(data.expectedCloseDate !== undefined && {
      expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
    }),
    ...(data.notes !== undefined && { notes: data.notes }),
  };
  return prisma.pipelineDeal.update({
    where: { id: dealId },
    data: update,
    include: {
      client: { select: { id: true, name: true } },
      stage: true,
    },
  });
}

export async function deleteDeal(prisma, dealId) {
  return prisma.pipelineDeal.delete({ where: { id: dealId } });
}

export async function getPipelineAnalytics(prisma) {
  const [totals, wonDeals, totalDeals] = await Promise.all([
    prisma.pipelineDeal.aggregate({
      _sum: { value: true },
      _avg: { probability: true },
    }),
    prisma.pipelineDeal.count({ where: { probability: { gte: 100 } } }),
    prisma.pipelineDeal.count(),
  ]);

  return {
    totalPipelineValue: totals._sum.value ?? 0,
    averageWinProbability: totals._avg.probability ?? 0,
    wonDeals,
    totalDeals,
    winRate: totalDeals > 0 ? (wonDeals / totalDeals) * 100 : 0,
    // Named funnel rates need explicit lifecycle evidence. Do not infer them
    // from arbitrary user-defined stage names.
    conversionRates: {},
  };
}
