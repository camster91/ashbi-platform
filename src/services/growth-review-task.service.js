import crypto from 'node:crypto';
import { summarizeLeadAcquisition } from './lead-acquisition-summary.service.js';

export class GrowthReviewTaskError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'GrowthReviewTaskError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const taskInclude = {
  project: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
};

function inputFingerprint({
  projectId,
  assigneeId,
  weekOf,
  action,
  dueDate,
  sourceCoverageReviewed,
  currenciesSeparated,
  missingAttributionDisclosed,
  externalActionState,
}) {
  return crypto.createHash('sha256').update(JSON.stringify([
    projectId,
    assigneeId,
    weekOf,
    action.trim(),
    new Date(dueDate).toISOString(),
    sourceCoverageReviewed,
    currenciesSeparated,
    missingAttributionDisclosed,
    externalActionState,
  ])).digest('hex');
}

function parseProperties(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function strongest(groups = []) {
  const first = groups[0];
  return first ? { key: first.key, count: first.count } : null;
}

function evidenceSnapshot(summary) {
  return {
    asOf: summary.asOf,
    window: summary.window,
    total: summary.total,
    sourceMissing: summary.attribution.sourceMissing,
    overdueFollowUp: summary.followUp.overdue,
    unscheduledFollowUp: summary.followUp.unscheduled,
    strongestService: strongest(summary.byServiceLine),
    strongestSource: strongest(summary.bySource),
  };
}

function evidenceLine(label, evidence) {
  const service = evidence.strongestService
    ? `${evidence.strongestService.key} (${evidence.strongestService.count})`
    : 'none recorded';
  const source = evidence.strongestSource
    ? `${evidence.strongestSource.key} (${evidence.strongestSource.count})`
    : 'none recorded';
  return `${label}: ${evidence.total} inquiries; ${evidence.sourceMissing} missing attribution; ${evidence.overdueFollowUp} overdue follow-up; ${evidence.unscheduledFollowUp} unscheduled; strongest service ${service}; strongest source ${source}.`;
}

function existingResult(existing, fingerprint) {
  if (!existing) return null;
  const properties = parseProperties(existing.properties);
  if (properties.inputFingerprint === fingerprint) return { task: existing, idempotent: true };
  throw new GrowthReviewTaskError(
    'A different growth action is already recorded for this week',
    'GROWTH_REVIEW_CONFLICT',
    409,
  );
}

export async function createWeeklyGrowthReviewTask({
  prisma,
  organizationId,
  projectId,
  assigneeId,
  actorUserId,
  weekOf,
  action,
  dueDate,
  sourceCoverageReviewed,
  currenciesSeparated,
  missingAttributionDisclosed,
  externalActionState,
  now = new Date(),
  summarize = summarizeLeadAcquisition,
}) {
  const normalizedAction = action.trim();
  const normalizedDueDate = new Date(dueDate).toISOString();
  const growthReviewKey = `growth-review:${organizationId}:${weekOf}`;
  const fingerprint = inputFingerprint({
    projectId,
    assigneeId,
    weekOf,
    action: normalizedAction,
    dueDate: normalizedDueDate,
    sourceCoverageReviewed,
    currenciesSeparated,
    missingAttributionDisclosed,
    externalActionState,
  });

  const [project, assignee] = await Promise.all([
    prisma.project.findFirst({ where: { id: projectId, organizationId, deletedAt: null } }),
    prisma.user.findFirst({ where: { id: assigneeId, organizationId, isActive: true } }),
  ]);
  if (!project || project.organizationId !== organizationId) {
    throw new GrowthReviewTaskError('Growth project not found', 'GROWTH_PROJECT_NOT_FOUND', 404);
  }
  if (!assignee || assignee.organizationId !== organizationId || assignee.isActive !== true) {
    throw new GrowthReviewTaskError('Growth owner not found', 'GROWTH_OWNER_NOT_FOUND', 404);
  }

  const existing = await prisma.task.findUnique({
    where: { growthReviewKey },
    include: taskInclude,
  });
  const replay = existingResult(existing, fingerprint);
  if (replay) return replay;

  const [thirtyDaySummary, ninetyDaySummary] = await Promise.all([
    summarize({ prisma, now, days: 30 }),
    summarize({ prisma, now, days: 90 }),
  ]);
  const evidence = {
    thirtyDays: evidenceSnapshot(thirtyDaySummary),
    ninetyDays: evidenceSnapshot(ninetyDaySummary),
  };
  const properties = {
    source: 'ASHBI_GROWTH_REVIEW',
    weekOf,
    action: normalizedAction,
    inputFingerprint: fingerprint,
    evidence,
    actorUserId,
    capturedAt: now.toISOString(),
    reviewAttestations: {
      sourceCoverageReviewed,
      currenciesSeparated,
      missingAttributionDisclosed,
      externalActionState,
    },
    externalActionBoundary: 'Internal task only; outreach, publishing, advertising, and provider changes require separate approval.',
  };
  const data = {
    title: `Growth action — Week of ${weekOf}`,
    description: [
      `Approved internal action: ${normalizedAction}`,
      evidenceLine('30-day evidence', evidence.thirtyDays),
      evidenceLine('90-day evidence', evidence.ninetyDays),
      `Review attestations: source coverage reviewed; currencies separated; missing attribution disclosed; external action ${externalActionState}.`,
      'Internal task only. This record does not send outreach, publish content, change advertising, or call a provider.',
    ].join('\n\n'),
    status: 'PENDING',
    category: 'THIS_WEEK',
    priority: 'HIGH',
    startDate: now,
    dueDate: new Date(normalizedDueDate),
    projectId,
    assigneeId,
    growthReviewKey,
    properties: JSON.stringify(properties),
    tags: JSON.stringify(['growth', 'weekly-review']),
  };

  try {
    const task = await prisma.task.create({ data, include: taskInclude });
    return { task, idempotent: false };
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    const concurrent = await prisma.task.findUnique({
      where: { growthReviewKey },
      include: taskInclude,
    });
    const concurrentReplay = existingResult(concurrent, fingerprint);
    if (concurrentReplay) return concurrentReplay;
    throw error;
  }
}
