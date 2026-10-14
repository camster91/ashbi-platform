const staffRoles = ['ADMIN', 'TEAM'];
const fail = () => { throw Object.assign(new Error('Team access required'), { statusCode: 403 }); };
const skills = value => {
  try { const parsed = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};

// Capacity is weekly hours in Profile. Compare logged hours with those hours,
// while showing owned work and explicit contributions as separate counts.
export async function readTeamWorkload(prisma, actor, now = new Date()) {
  if (!actor?.organizationId || !staffRoles.includes(actor.role)) fail();
  const organizationId = actor.organizationId;
  const activeTask = { deletedAt: null, status: { not: 'COMPLETED' }, project: { organizationId, deletedAt: null } };
  const [owned, contributed, threads, time] = await Promise.all([
    prisma.task.groupBy({ by: ['assigneeId'], where: activeTask, _count: { _all: true } }),
    prisma.taskCollaborator.groupBy({ by: ['userId'], where: { organizationId, task: activeTask }, _count: { _all: true } }),
    prisma.thread.groupBy({ by: ['assignedToId'], where: { status: { not: 'RESOLVED' }, assignedTo: { organizationId }, OR: [{ client: { organizationId, deletedAt: null } }, { clientId: null, project: { organizationId, deletedAt: null } }, { clientId: null, projectId: null }] }, _count: { _all: true } }),
    prisma.timeEntry.groupBy({ by: ['userId'], where: { deletedAt: null, project: { organizationId, deletedAt: null }, date: { gte: new Date(now.getTime() - 7 * 86400000), lte: now } }, _sum: { duration: true } }),
  ]);
  const counts = (rows, key) => new Map(rows.map(row => [row[key], row._count._all]));
  const ownerCounts = counts(owned, 'assigneeId');
  const contributionCounts = counts(contributed, 'userId');
  const threadCounts = counts(threads, 'assignedToId');
  const minutes = new Map(time.map(row => [row.userId, row._sum.duration ?? 0]));
  const result = [];
  let after;
  for (;;) {
    const members = await prisma.user.findMany({ where: { organizationId, isActive: true, role: { in: staffRoles }, ...(after ? { id: { gt: after } } : {}) }, select: { id: true, name: true, role: true, skills: true, capacity: true }, take: 100, orderBy: { id: 'asc' } });
    for (const member of members) {
      const weeklyCapacityHours = Number.isFinite(member.capacity) && member.capacity > 0 ? member.capacity : 0;
      const weeklyHours = (minutes.get(member.id) ?? 0) / 60;
      const utilizationPercent = weeklyCapacityHours ? Math.round(weeklyHours / weeklyCapacityHours * 100) : null;
      result.push({ id: member.id, name: member.name, role: member.role, skills: skills(member.skills), activeTasks: ownerCounts.get(member.id) ?? 0, contributedTasks: contributionCounts.get(member.id) ?? 0, activeThreads: threadCounts.get(member.id) ?? 0, capacity: member.capacity, weeklyCapacityHours, weeklyHours, utilizationPercent, status: utilizationPercent === null ? 'unconfigured' : utilizationPercent >= 90 ? 'overloaded' : utilizationPercent >= 70 ? 'busy' : 'available', measurement: 'LOGGED_LAST_7_DAYS' });
    }
    if (members.length < 100) break;
    after = members.at(-1).id;
  }
  return result.sort((a, b) => (a.utilizationPercent ?? -1) - (b.utilizationPercent ?? -1) || a.name.localeCompare(b.name));
}

export async function readTeamAllocations(prisma, actor, now = new Date()) {
  const workload = await readTeamWorkload(prisma, actor, now);
  const groups = await prisma.task.groupBy({ by: ['assigneeId', 'projectId'], where: { deletedAt: null, status: { not: 'COMPLETED' }, project: { organizationId: actor.organizationId, deletedAt: null } }, _count: { _all: true } });
  const ids = [...new Set(groups.map(row => row.projectId))];
  const projects = new Map();
  for (let index = 0; index < ids.length; index += 100) {
    const rows = await prisma.project.findMany({ where: { organizationId: actor.organizationId, deletedAt: null, id: { in: ids.slice(index, index + 100) } }, select: { id: true, name: true }, take: 100 });
    for (const row of rows) projects.set(row.id, row);
  }
  const byOwner = new Map();
  for (const row of groups) {
    if (!projects.has(row.projectId)) continue;
    if (!byOwner.has(row.assigneeId)) byOwner.set(row.assigneeId, []);
    byOwner.get(row.assigneeId).push({ project: projects.get(row.projectId), taskCount: row._count._all });
  }
  return { allocations: workload.map(member => ({ ...member, utilization: member.utilizationPercent, projects: byOwner.get(member.id) ?? [] })) };
}
