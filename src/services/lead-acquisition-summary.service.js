const ACTIVE_FOLLOW_UP_STATUSES = ['REVIEWING', 'QUALIFIED', 'NURTURE'];

function summarizedGroups(rows, field, fallback = 'UNSPECIFIED') {
  return rows
    .map((row) => ({
      key: row[field] || fallback,
      count: row._count._all,
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export async function summarizeLeadAcquisition({ prisma, now = new Date(), days }) {
  return prisma.$transaction(async (transaction) => {
    const from = days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null;
    const windowFilter = from ? { createdAt: { gte: from } } : {};
    const activeFollowUp = { status: { in: ACTIVE_FOLLOW_UP_STATUSES } };
    const [
      total,
      statuses,
      serviceLines,
      sources,
      sourceMissing,
      scheduled,
      overdue,
      unscheduled,
    ] = await Promise.all([
      transaction.lead.count({ where: windowFilter }),
      transaction.lead.groupBy({ by: ['status'], where: windowFilter, _count: { _all: true } }),
      transaction.lead.groupBy({ by: ['serviceLine'], where: windowFilter, _count: { _all: true } }),
      transaction.lead.groupBy({ by: ['source'], where: windowFilter, _count: { _all: true } }),
      transaction.lead.count({ where: { ...windowFilter, source: null } }),
      transaction.lead.count({
        where: {
          ...activeFollowUp,
          nextAction: { not: null },
          nextActionDueAt: { not: null },
        },
      }),
      transaction.lead.count({
        where: {
          ...activeFollowUp,
          nextActionDueAt: { lt: now },
        },
      }),
      transaction.lead.count({
        where: {
          ...activeFollowUp,
          OR: [{ nextAction: null }, { nextActionDueAt: null }],
        },
      }),
    ]);

    return {
      asOf: now.toISOString(),
      window: { days: days ?? null, from: from?.toISOString() ?? null },
      total,
      attribution: {
        sourceCaptured: total - sourceMissing,
        sourceMissing,
      },
      followUp: { scheduled, overdue, unscheduled },
      byStatus: summarizedGroups(statuses, 'status'),
      byServiceLine: summarizedGroups(serviceLines, 'serviceLine'),
      bySource: summarizedGroups(sources, 'source', 'UNATTRIBUTED'),
    };
  });
}
