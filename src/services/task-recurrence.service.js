import { dateInZone, firstRecurrenceOnOrAfter, recurrenceAfter } from '../shared/task-recurrence.js';
import { taskRecurrenceRuleSchema } from '../validators/schemas.js';
import { withStageTransaction } from './task-stages.service.js';

const asDate = text => new Date(`${text}T00:00:00Z`);
const dateText = date => new Date(date).toISOString().slice(0, 10);
const fail = (statusCode, message) => { throw Object.assign(new Error(message), { statusCode }); };

export async function saveTaskRecurrence(prisma, id, { rule, revision }, now = new Date()) {
  return withStageTransaction(prisma, async tx => {
    const task = await tx.task.findFirst({ where: { id } });
    if (!task) fail(404, 'Task not found');
    if (task.recurrenceSourceId) fail(400, 'Change the schedule on the original recurring task.');
    if (task.recurrenceRevision !== revision) fail(409, 'Recurrence changed since you opened it. Reload and try again.');
    let next = rule ? firstRecurrenceOnOrAfter(rule, dateInZone(now, rule.timeZone)) : null;
    if (rule && task.recurrenceLastDate && next <= dateText(task.recurrenceLastDate)) next = recurrenceAfter(rule, dateText(task.recurrenceLastDate));
    return tx.task.update({ where: { id }, data: { recurrenceRule: rule ?? {}, recurrenceNextDate: next ? asDate(next) : null,
      recurrenceRevision: { increment: 1 } }, select: { id: true, recurrenceRule: true, recurrenceNextDate: true, recurrenceRevision: true } });
  }, 'Recurrence changed while saving. Reload and try again.');
}

// One catch-up instance per source, not a backlog. Claim, copy and advance atomically.
export async function processRecurringTasks(prisma, { now = new Date() } = {}) {
  let generated = 0;
  let examined = 0;
  const failures = [];
  let after;
  for (;;) {
    const sources = await prisma.task.findMany({ where: { recurrenceNextDate: { not: null },
      ...(after ? { id: { gt: after } } : {}), project: { deletedAt: null, status: { notIn: ['ON_HOLD', 'CANCELLED'] } } },
    orderBy: { id: 'asc' }, take: 100 });
    for (const source of sources) {
      examined += 1;
      try {
      const parsed = taskRecurrenceRuleSchema.safeParse(source.recurrenceRule);
      if (!parsed.success) fail(500, 'A recurring task has invalid schedule data.');
      const rule = parsed.data;
      const today = dateInZone(now, rule.timeZone);
      const scheduledDate = new Date(source.recurrenceNextDate);
      if (dateText(scheduledDate) > today) continue;
      const next = asDate(recurrenceAfter(rule, today));
      const occurrence = await prisma.$transaction(async tx => {
        const live = await tx.task.findFirst({ where: { id: source.id, project: { deletedAt: null, status: { notIn: ['ON_HOLD', 'CANCELLED'] } } } });
        if (!live) return null;
        const claimed = await tx.task.updateMany({ where: { id: source.id, recurrenceNextDate: scheduledDate,
          recurrenceRevision: source.recurrenceRevision }, data: { recurrenceNextDate: next, recurrenceLastDate: scheduledDate } });
        if (claimed.count !== 1) return null;
        const owner = live.assigneeId ? await tx.user.findFirst({ where: { id: live.assigneeId, isActive: true }, select: { id: true } }) : null;
        return tx.task.create({ data: { projectId: live.projectId, title: live.title, description: live.description,
          content: live.content, properties: live.properties, ...(live.fieldValues ? { fieldValues: live.fieldValues } : {}), tags: live.tags, priority: live.priority, category: live.category,
          icon: live.icon, coverImage: live.coverImage, estimatedTime: live.estimatedTime,
          assigneeId: owner?.id ?? null, status: 'PENDING', dueDate: scheduledDate,
          recurrenceSourceId: source.id, recurrenceScheduledDate: scheduledDate } });
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
