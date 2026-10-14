import { dateInZone, firstRecurrenceOnOrAfter, recurrenceAfter, completionRepeatDate } from '../shared/task-recurrence.js';
import { taskRecurrenceRuleSchema } from '../validators/schemas.js';
import { withStageTransaction } from './task-stages.service.js';

const asDate = text => new Date(`${text}T00:00:00Z`);
const dateText = date => new Date(date).toISOString().slice(0, 10);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };
const activeBoard = { OR: [{ boardId: null }, { board: { archivedAt: null } }] };

export async function saveTaskRecurrence(prisma, id, { rule, revision }, now = new Date()) {
  return withStageTransaction(prisma, tx => saveTaskRecurrenceInTransaction(tx, id, { rule, revision }, now), 'Recurrence changed while saving. Reload and try again.');
}

export async function saveTaskRecurrenceInTransaction(tx, id, { rule, revision, projectId }, now = new Date()) {
    const task = await tx.task.findFirst({ where: { id, ...(projectId ? { projectId } : {}) } });
    if (!task) fail(404, 'Task not found');
    if (task.recurrenceSourceId) fail(400, 'Change the schedule on the original recurring task.');
    if (task.recurrenceRevision !== revision) fail(409, 'Recurrence changed since you opened it. Reload and try again.');
    const afterCompletion = rule?.trigger === 'AFTER_COMPLETION';
    const activatingCompletion = afterCompletion && task.recurrenceRule?.trigger !== 'AFTER_COMPLETION';
    let next = rule && !afterCompletion ? firstRecurrenceOnOrAfter(rule, dateInZone(now, rule.timeZone)) : null;
    if (next && task.recurrenceLastDate && next <= dateText(task.recurrenceLastDate)) next = recurrenceAfter(rule, dateText(task.recurrenceLastDate));
    const claimed = await tx.task.updateMany({ where: { id, ...(projectId ? { projectId } : {}), recurrenceSourceId: null, recurrenceRevision: revision }, data: { recurrenceRule: rule ?? {}, recurrenceNextDate: next ? asDate(next) : null, recurrenceRevision: { increment: 1 } } });
    if (claimed.count !== 1) fail(409, 'Recurrence changed while saving. Reload and try again.');
    // Enabling this option never replays completed historical work, including
    // old calendar instances whose original is switching recurrence mode.
    if (activatingCompletion) {
      await tx.task.updateMany({ where: { OR: [{ id }, { recurrenceSourceId: id }], recurrenceFirstCompletedAt: { not: null }, recurrenceCompletionProcessedAt: null }, data: { recurrenceCompletionProcessedAt: now } });
    }
    return tx.task.findFirst({ where: { id }, select: { id: true, recurrenceRule: true, recurrenceNextDate: true, recurrenceRevision: true } });
}

async function copyRecurringTask(tx, live, recurrence) {
  const organizationId = live.project.organizationId;
  const owner = live.assigneeId ? await tx.user.findFirst({ where: { id: live.assigneeId, organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } }, select: { id: true } }) : null;
  const contributors = await tx.taskCollaborator.findMany({ where: { taskId: live.id, organizationId, user: { organizationId, isActive: true, role: { in: ['ADMIN', 'TEAM'] } } }, select: { userId: true }, take: 30, orderBy: { userId: 'asc' } });
  const created = await tx.task.create({ data: { projectId: live.projectId, ...(live.boardId ? { boardId: live.boardId } : {}), title: live.title, description: live.description,
    content: live.content, properties: live.properties, ...(live.fieldValues ? { fieldValues: live.fieldValues } : {}), tags: live.tags, priority: live.priority, category: live.category,
    icon: live.icon, coverImage: live.coverImage, estimatedTime: live.estimatedTime,
    assigneeId: owner?.id ?? null, status: 'PENDING', ...recurrence } });
  if (contributors.length) await tx.taskCollaborator.createMany({ data: contributors.map(({ userId }) => ({ taskId: created.id, userId, organizationId })) });
  return created;
}

// First completion per task is claimed with its copy in one transaction. The
// unique source id also prevents a second copy after reopening or a lost reply.
export async function processCompletionRepeats(prisma, { now = new Date() } = {}) {
  let generated = 0;
  let examined = 0;
  let after;
  const failures = [];
  const activeProject = { deletedAt: null, status: { notIn: ['ON_HOLD', 'CANCELLED'] } };
  for (;;) {
    const roots = await prisma.task.findMany({ where: { AND: [activeBoard], deletedAt: null, recurrenceSourceId: null, recurrenceRule: { path: ['trigger'], equals: 'AFTER_COMPLETION' },
      ...(after ? { id: { gt: after } } : {}), project: activeProject }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
    for (const source of roots) {
      let completedAfter;
      for (;;) {
      const completed = await prisma.task.findMany({ where: { AND: [activeBoard], deletedAt: null, OR: [{ id: source.id }, { recurrenceSourceId: source.id }], status: 'COMPLETED', recurrenceFirstCompletedAt: { not: null }, recurrenceCompletionProcessedAt: null,
        ...(completedAfter ? { id: { gt: completedAfter } } : {}), project: activeProject }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
      for (const candidate of completed) {
      examined++;
      try {
        const occurrence = await prisma.$transaction(async tx => {
          const live = await tx.task.findFirst({ where: { id: candidate.id, AND: [activeBoard], deletedAt: null, OR: [{ id: source.id }, { recurrenceSourceId: source.id }], status: 'COMPLETED', recurrenceCompletionProcessedAt: null, project: activeProject }, include: { project: { select: { organizationId: true } } } });
          if (!live?.recurrenceFirstCompletedAt) return null;
          const root = await tx.task.findFirst({ where: { id: source.id, AND: [activeBoard], deletedAt: null, projectId: live.projectId, project: { ...activeProject, organizationId: live.project.organizationId } } });
          if (!root || root.recurrenceRule?.trigger !== 'AFTER_COMPLETION' || root.recurrenceSourceId) return null;
          const rule = taskRecurrenceRuleSchema.safeParse(root?.recurrenceRule);
          if (!rule.success) fail(500, 'A completion repeat has invalid schedule data.');
          // Lock the original's observed revision before claiming a child, so
          // a concurrent stop/edit cannot finish ahead of an old-rule copy.
          const schedule = await tx.task.updateMany({ where: { id: root.id, recurrenceRevision: root.recurrenceRevision, recurrenceRule: { path: ['trigger'], equals: 'AFTER_COMPLETION' } }, data: { recurrenceRevision: root.recurrenceRevision } });
          if (schedule.count !== 1) return null;
          const claimed = await tx.task.updateMany({ where: { id: live.id, status: 'COMPLETED', recurrenceCompletionProcessedAt: null }, data: { recurrenceCompletionProcessedAt: now } });
          if (claimed.count !== 1) return null;
          return copyRecurringTask(tx, live, { dueDate: asDate(completionRepeatDate(rule.data, live.recurrenceFirstCompletedAt)), recurrenceSourceId: root.id, recurrenceCompletionSourceId: live.id });
        }, { isolationLevel: 'Serializable' });
        if (occurrence) generated++;
      } catch (error) { failures.push({ taskId: candidate.id, code: error.code ?? 'RECURRENCE_FAILED' }); }
      }
      if (completed.length < 100) break;
      completedAfter = completed.at(-1).id;
      }
    }
    if (roots.length < 100) break;
    after = roots.at(-1).id;
  }
  if (failures.length) throw Object.assign(new Error(`Failed to generate ${failures.length} completion repeat(s)`), { failures });
  return { examined, generated };
}

// One catch-up instance per source, not a backlog. Claim, copy and advance atomically.
export async function processRecurringTasks(prisma, { now = new Date() } = {}) {
  let generated = 0;
  let examined = 0;
  const failures = [];
  let after;
  for (;;) {
    const sources = await prisma.task.findMany({ where: { AND: [activeBoard], recurrenceNextDate: { not: null },
      ...(after ? { id: { gt: after } } : {}), project: { deletedAt: null, status: { notIn: ['ON_HOLD', 'CANCELLED'] } } },
    orderBy: { id: 'asc' }, take: 100 });
    for (const source of sources) {
      examined += 1;
      try {
      const parsed = taskRecurrenceRuleSchema.safeParse(source.recurrenceRule);
      if (!parsed.success) fail(500, 'A recurring task has invalid schedule data.');
      const rule = parsed.data;
      if (rule.trigger === 'AFTER_COMPLETION') continue;
      const today = dateInZone(now, rule.timeZone);
      const scheduledDate = new Date(source.recurrenceNextDate);
      if (dateText(scheduledDate) > today) continue;
      const next = asDate(recurrenceAfter(rule, today));
      const occurrence = await prisma.$transaction(async tx => {
        const live = await tx.task.findFirst({ where: { id: source.id, AND: [activeBoard], project: { deletedAt: null, status: { notIn: ['ON_HOLD', 'CANCELLED'] } } }, include: { project: { select: { organizationId: true } } } });
        if (!live) return null;
        const claimed = await tx.task.updateMany({ where: { id: source.id, recurrenceNextDate: scheduledDate,
          recurrenceRevision: source.recurrenceRevision }, data: { recurrenceNextDate: next, recurrenceLastDate: scheduledDate } });
        if (claimed.count !== 1) return null;
        return copyRecurringTask(tx, live, { dueDate: scheduledDate, recurrenceSourceId: source.id, recurrenceScheduledDate: scheduledDate });
      }, { isolationLevel: 'Serializable' });
      if (occurrence) generated += 1;
      } catch (error) { failures.push({ taskId: source.id, code: error.code ?? 'RECURRENCE_FAILED' }); }
    }
    if (sources.length < 100) break;
    after = sources.at(-1).id;
  }
  if (failures.length) throw Object.assign(new Error(`Failed to generate ${failures.length} recurring task(s)`), { failures });
  return { examined, generated };
}
