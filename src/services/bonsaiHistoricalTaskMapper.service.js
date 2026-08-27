const STATUS_MAP = Object.freeze({
  done: 'COMPLETED',
  'in progress': 'IN_PROGRESS',
  'to do': 'PENDING',
});

const PRIORITY_MAP = Object.freeze({
  urgent: 'CRITICAL',
  high: 'HIGH',
  medium: 'NORMAL',
  low: 'LOW',
  '': 'NORMAL',
});

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function sourceDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw.replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? '' : 'Z'));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function projectKey(company, project) {
  return `${normalized(company)}|${normalized(project)}`;
}

function taskEvidence(row) {
  return {
    taskList: String(row['Task List'] ?? '').trim() || null,
    progress: String(row.Progress ?? '').trim() || null,
    estimate: String(row.Estimate ?? '').trim() || null,
    timeTracked: String(row['Time Tracked'] ?? '').trim() || null,
    timeRemaining: String(row['Time Remaining'] ?? '').trim() || null,
    billing: String(row.Billing ?? '').trim() || null,
    service: String(row.Service ?? '').trim() || null,
    tags: String(row.Tags ?? '').trim() || null,
    taskType: String(row['Task Type'] ?? '').trim() || null,
  };
}

export function mapBonsaiHistoricalTasks({
  taskRows,
  projectRows,
  currentTasks = [],
  shouldSkipClient = () => false,
}) {
  if (!Array.isArray(taskRows) || !Array.isArray(projectRows) || !Array.isArray(currentTasks)) {
    throw new TypeError('Historical task, project, and current task source rows must be arrays');
  }

  const findings = [];
  const projectGroups = groupBy(
    projectRows.filter(row => normalized(row.title) && !shouldSkipClient(row.client_or_company_name)),
    row => projectKey(row.client_or_company_name, row.title),
  );
  const sourceGroups = groupBy(taskRows, row => String(row['Task ID'] ?? '').trim());
  // Bonsai's native export uses a human project code while the API snapshot
  // uses a numeric project ID. Exact task title + displayed project title is
  // therefore retained as an unresolved overlap signal, never as an identity
  // merge. A reviewer must decide which source record survives.
  const currentKeys = new Set(currentTasks.map(task => `${normalized(task.title)}|${normalized(task.project_title)}`));
  const candidateTasks = [];

  for (let index = 0; index < taskRows.length; index += 1) {
    const row = taskRows[index];
    const sourceRow = index + 2;
    const sourceId = String(row['Task ID'] ?? '').trim();
    const title = String(row['Task Name'] ?? '').trim();
    const company = String(row.Company ?? '').trim();
    const projectTitle = String(row.Project ?? '').trim();
    const parentSourceId = String(row['Parent Task ID'] ?? '').trim() || null;
    const projectMatches = projectGroups.get(projectKey(company, projectTitle)) ?? [];
    const status = STATUS_MAP[normalized(row.Status)];
    const priority = PRIORITY_MAP[normalized(row.Priority)];
    const startDate = sourceDate(row['Start Date']);
    const dueDate = sourceDate(row['Due Date']);
    const createdAt = sourceDate(row.Created);
    const invalidFields = [];
    if (!sourceId) invalidFields.push('Task ID');
    if (!title) invalidFields.push('Task Name');
    if (sourceId && sourceGroups.get(sourceId)?.length !== 1) invalidFields.push('duplicate Task ID');
    if (!projectTitle || !company) invalidFields.push('project identity');
    else if (projectMatches.length !== 1) invalidFields.push(projectMatches.length > 1 ? 'ambiguous project identity' : 'missing project identity');
    if (!status) invalidFields.push('Status');
    if (!priority) invalidFields.push('Priority');
    if (row['Start Date'] && startDate === undefined) invalidFields.push('Start Date');
    if (row['Due Date'] && dueDate === undefined) invalidFields.push('Due Date');
    if (row.Created && createdAt === undefined) invalidFields.push('Created');
    if (parentSourceId === sourceId) invalidFields.push('self parent');
    if (shouldSkipClient(company)) invalidFields.push('excluded client');
    if (invalidFields.length > 0) {
      findings.push({ code: 'BONSAI_HISTORICAL_TASK_SOURCE_INVALID', sourceRow, sourceId, fields: invalidFields });
      continue;
    }

    const projectSourceId = String(projectMatches[0].project_id ?? '').trim();
    if (!projectSourceId) {
      findings.push({ code: 'BONSAI_HISTORICAL_TASK_SOURCE_INVALID', sourceRow, sourceId, fields: ['project source ID'] });
      continue;
    }
    if (currentKeys.has(`${normalized(title)}|${normalized(projectTitle)}`)) {
      findings.push({ code: 'BONSAI_TASK_SOURCE_OVERLAP_UNRESOLVED', sourceRow, sourceId, projectSourceId });
      continue;
    }

    candidateTasks.push({
      sourceRow,
      sourceId,
      title,
      projectSourceId,
      parentSourceId,
      ownerName: String(row.Assignee ?? '').trim(),
      status,
      priority,
      startDate: startDate ?? null,
      dueDate: dueDate ?? null,
      createdAt: createdAt ?? null,
      evidence: taskEvidence(row),
    });
  }

  const candidatesById = new Map(candidateTasks.map(task => [task.sourceId, task]));
  const invalidParentTasks = new Set();
  for (const task of candidateTasks) {
    if (task.parentSourceId && !candidatesById.has(task.parentSourceId)) {
      invalidParentTasks.add(task.sourceId);
      findings.push({
        code: 'BONSAI_HISTORICAL_TASK_PARENT_UNAVAILABLE',
        sourceRow: task.sourceRow,
        sourceId: task.sourceId,
        parentSourceId: task.parentSourceId,
      });
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(task) {
    if (visited.has(task.sourceId) || invalidParentTasks.has(task.sourceId)) return;
    if (visiting.has(task.sourceId)) {
      invalidParentTasks.add(task.sourceId);
      findings.push({ code: 'BONSAI_HISTORICAL_TASK_PARENT_CYCLE', sourceId: task.sourceId });
      return;
    }
    visiting.add(task.sourceId);
    if (task.parentSourceId) visit(candidatesById.get(task.parentSourceId));
    visiting.delete(task.sourceId);
    visited.add(task.sourceId);
  }
  for (const task of candidateTasks) visit(task);
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const task of candidateTasks) {
      if (task.parentSourceId && invalidParentTasks.has(task.parentSourceId) && !invalidParentTasks.has(task.sourceId)) {
        invalidParentTasks.add(task.sourceId);
        findings.push({
          code: 'BONSAI_HISTORICAL_TASK_PARENT_UNAVAILABLE',
          sourceRow: task.sourceRow,
          sourceId: task.sourceId,
          parentSourceId: task.parentSourceId,
        });
        propagated = true;
      }
    }
  }

  return {
    tasks: candidateTasks.filter(task => !invalidParentTasks.has(task.sourceId)),
    findings,
    summary: {
      sourceTasks: taskRows.length,
      mappedTasks: candidateTasks.length - invalidParentTasks.size,
      parentTasks: candidateTasks.filter(task => task.parentSourceId).length,
      findings: findings.length,
    },
  };
}
