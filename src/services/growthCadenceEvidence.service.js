const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EXTERNAL_ACTION_STATES = new Set(['NOT_REQUIRED', 'PENDING', 'APPROVED', 'DECLINED']);

function timestamp(value, label) {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''));
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid timestamp`);
  return parsed;
}

function parseProperties(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error('Growth review task properties are invalid');
  }
}

function monday(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''))) throw new Error('First week must be a calendar Monday');
  const parsed = timestamp(`${value}T00:00:00.000Z`, 'First week');
  const date = new Date(parsed);
  if (date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== value) {
    throw new Error('First week must be a calendar Monday');
  }
  return parsed;
}

function expectedWeeks(firstWeek, count = 4) {
  const first = monday(firstWeek);
  return Array.from({ length: count }, (_, index) => new Date(first + index * WEEK_MS).toISOString().slice(0, 10));
}

function normalizedReview(task, organizationId, weekStart, generatedAt) {
  if (task?.growthReviewKey !== `growth-review:${organizationId}:${weekStart}` || task?.status !== 'COMPLETED') {
    throw new Error(`Growth review ${weekStart} is missing or incomplete`);
  }
  if (!task.id || !task.assigneeId || !task.dueDate || !task.completedAt) {
    throw new Error(`Growth review ${weekStart} lacks task, owner, due, or completion evidence`);
  }
  const week = monday(weekStart);
  const dueAt = timestamp(task.dueDate, 'Growth task due date');
  const completedAt = timestamp(task.completedAt, 'Growth task completion');
  if (dueAt < week || dueAt >= week + WEEK_MS || completedAt < week || completedAt >= week + WEEK_MS
    || completedAt > generatedAt) {
    throw new Error(`Growth review ${weekStart} falls outside its evidence week`);
  }
  const properties = parseProperties(task.properties);
  const attestations = properties.reviewAttestations;
  if (properties.source !== 'ASHBI_GROWTH_REVIEW' || properties.weekOf !== weekStart
    || attestations?.sourceCoverageReviewed !== true
    || attestations?.currenciesSeparated !== true
    || attestations?.missingAttributionDisclosed !== true
    || !EXTERNAL_ACTION_STATES.has(attestations?.externalActionState)) {
    throw new Error(`Growth review ${weekStart} lacks required human attestations`);
  }
  const thirtyDays = properties.evidence?.thirtyDays;
  const baselineStart = timestamp(thirtyDays?.window?.from, '30-day baseline start');
  const baselineEnd = timestamp(thirtyDays?.asOf, '30-day baseline end');
  if (thirtyDays?.window?.days !== 30 || baselineEnd - baselineStart < 30 * DAY_MS || baselineEnd > generatedAt) {
    throw new Error(`Growth review ${weekStart} lacks a complete 30-day evidence window`);
  }
  return {
    weekStart,
    actionTaskId: task.id,
    ownerId: task.assigneeId,
    dueDate: new Date(dueAt).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    externalActionState: attestations.externalActionState,
    evidence: properties.evidence,
  };
}

export function buildGrowthCadenceEvidence({
  organizationId,
  firstWeek,
  tasks,
  generatedAt = new Date(),
} = {}) {
  const organization = String(organizationId ?? '').trim();
  if (!organization) throw new Error('Organization is required');
  const generated = timestamp(generatedAt, 'Evidence generation time');
  const weeks = expectedWeeks(firstWeek);
  const taskByKey = new Map();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task?.growthReviewKey) continue;
    if (taskByKey.has(task.growthReviewKey)) throw new Error('Duplicate growth review task evidence');
    taskByKey.set(task.growthReviewKey, task);
  }
  const weeklyReviews = weeks.map(weekStart => normalizedReview(
    taskByKey.get(`growth-review:${organization}:${weekStart}`),
    organization,
    weekStart,
    generated,
  ));
  const firstEvidence = weeklyReviews[0].evidence.thirtyDays;
  return {
    format: 'ashbi-growth-cadence-evidence',
    version: 1,
    complete: true,
    organizationId: organization,
    generatedAt: new Date(generated).toISOString(),
    baseline: {
      startedAt: new Date(timestamp(firstEvidence.window.from, '30-day baseline start')).toISOString(),
      endedAt: new Date(timestamp(firstEvidence.asOf, '30-day baseline end')).toISOString(),
      sourceCoverageReviewed: true,
      currenciesSeparated: true,
      missingAttributionDisclosed: true,
      totalInquiries: firstEvidence.total,
      sourceMissing: firstEvidence.sourceMissing,
    },
    weeklyReviews,
  };
}
