function fail(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}

// Scoped Prisma is retained by the tenant proxy inside interactive transactions.
// Serializable prevents config deletion from racing a move/create into that stage.
export async function withStageTransaction(prisma, work) {
  try {
    return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
  } catch (error) {
    if (error.code === 'P2034') fail(409, 'Board changed while saving. Reload and try again.');
    throw error;
  }
}

export async function resolveTaskStage(prisma, projectId, key) {
  const project = await prisma.project.findFirst({ where: { id: projectId }, select: { taskStages: true } });
  if (!project) fail(404, 'Project not found');
  const stage = Array.isArray(project.taskStages) && project.taskStages.find(item => item.key === key);
  if (!stage) fail(400, 'Stage is unavailable in this project. Reload the board.');
  return stage;
}

export async function saveTaskStages(prisma, projectId, { revision, stages }) {
  return withStageTransaction(prisma, async tx => {
    const project = await tx.project.findFirst({ where: { id: projectId }, select: { id: true, boardRevision: true, taskStages: true } });
    if (!project) fail(404, 'Project not found');
    if (project.boardRevision !== revision) fail(409, 'Board changed since you opened settings. Reload and try again.');
    const retained = stages.map(stage => stage.key);
    const occupied = await tx.task.count({ where: { projectId, stageKey: { not: null, notIn: retained } } });
    if (occupied) fail(409, 'Move tasks out of removed stages before saving.');
    return tx.project.update({ where: { id: projectId }, data: { taskStages: stages, boardRevision: { increment: 1 } },
      select: { id: true, taskStages: true, boardRevision: true } });
  });
}
