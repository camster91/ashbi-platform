const ACTIVE_FOLLOW_UP_STATUSES = ['REVIEWING', 'QUALIFIED', 'NURTURE'];

function summarizedGroups(rows, field, fallback = 'UNSPECIFIED') {
  return rows
    .map((row) => ({
      key: row[field] || fallback,
      count: row._count._all,
    }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

export async function summarizeLeadAcquisition({ prisma, now = new Date() }) {
  return prisma.$transaction(async (transaction) => {
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
      transaction.lead.count(),
      transaction.lead.groupBy({ by: ['status'], _count: { _all: true } }),
      transaction.lead.groupBy({ by: ['serviceLine'], _count: { _all: true } }),
      transaction.lead.groupBy({ by: ['source'], _count: { _all: true } }),
      transaction.lead.count({ where: { source: null } }),
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
