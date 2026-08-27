import { verifyWorkspaceExport, workspaceExportCollections } from './workspace-export-integrity.service.js';
import { mapBonsaiHistoricalTasks } from './bonsaiHistoricalTaskMapper.service.js';

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

function requireSha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return value.toLowerCase();
}

function timestamp(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString().slice(0, 10);
}

function taskStatus(task) {
  const state = normalized(task?.task_status?.state);
  const label = normalized(task?.task_status?.status);
  if (state === 'complete') return 'COMPLETED';
  if (state !== 'active') return null;
  if (label.includes('blocked') || label.includes('waiting')) return 'BLOCKED';
  if (label.includes('progress') || label === 'doing') return 'IN_PROGRESS';
  return 'PENDING';
}

function parseProperties(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function groupBy(items, keyFor) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function matchingUsers(users, ownerName) {
  const owner = normalized(ownerName);
  if (!owner) return [];
  const exact = users.filter(user => normalized(user.name) === owner);
  if (exact.length > 0) return exact;
  const firstName = owner.includes('cameron') ? 'cameron'
    : owner.includes('bianca') ? 'bianca' : owner.split(/\s+/)[0];
  return users.filter(user => normalized(user.name).split(/\s+/).includes(firstName));
}

export function reconcileBonsaiTasks({
  organizationId,
  completedAt,
  bonsaiTasksSha256,
  bonsaiHistoricalTasksSha256,
  bonsaiProjectsSha256,
  workspaceArtifactSha256,
  bonsaiTaskSnapshot,
  bonsaiHistoricalTaskRows,
  bonsaiProjectRows,
  workspaceExport,
}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required');
  if (workspaceExport?.organization?.id !== organizationId || !verifyWorkspaceExport(workspaceExport).valid) {
    throw new TypeError('A valid tenant-matched workspace export is required');
  }
  if (workspaceExport.version !== 3) throw new TypeError('Task reconciliation requires workspace export version 3');
  if (bonsaiTaskSnapshot?.format !== 'bonsai-task-snapshot'
    || bonsaiTaskSnapshot?.version !== 1
    || bonsaiTaskSnapshot?.scope !== 'all'
    || bonsaiTaskSnapshot?.complete !== true
    || !Array.isArray(bonsaiTaskSnapshot?.tasks)) {
    throw new TypeError('A complete all-scope Bonsai task snapshot version 1 is required');
  }
  const completed = timestamp(completedAt);
  const captured = timestamp(bonsaiTaskSnapshot.capturedAt);
  const exported = timestamp(workspaceExport.exportedAt);
  if (completed === null) throw new TypeError('completedAt must be a valid date');
  if (captured === null || exported === null) throw new TypeError('Source and workspace exports require valid timestamps');
  if (completed < captured || completed < exported) throw new TypeError('completedAt must not predate source evidence');

  const sourceTasks = bonsaiTaskSnapshot.tasks;
  const includesHistory = Array.isArray(bonsaiHistoricalTaskRows);
  if (includesHistory && !Array.isArray(bonsaiProjectRows)) {
    throw new TypeError('Historical task reconciliation requires Bonsai project rows');
  }
  const findings = [];
  const sourceGroups = groupBy(sourceTasks, task => String(task?.uuid ?? '').trim());
  const duplicateSourceIds = new Set();
  for (const [sourceId, tasks] of sourceGroups) {
    if (sourceId && tasks.length > 1) {
      duplicateSourceIds.add(sourceId);
      findings.push({ code: 'DUPLICATE_BONSAI_TASK_ID', sourceId, rows: tasks.length });
    }
  }

  const hubGroups = new Map();
  for (const task of workspaceExport.records.tasks) {
    const sourceId = String(parseProperties(task.properties).bonsaiTaskId ?? '').trim();
    if (!sourceId) continue;
    hubGroups.set(sourceId, [...(hubGroups.get(sourceId) ?? []), task]);
  }
  const duplicateHubIds = new Set();
  for (const [sourceId, tasks] of hubGroups) {
    if (tasks.length > 1) {
      duplicateHubIds.add(sourceId);
      findings.push({ code: 'DUPLICATE_HUB_BONSAI_TASK_ID', sourceId, hubTaskIds: tasks.map(task => task.id).sort() });
    }
  }

  const projectsBySourceId = groupBy(
    workspaceExport.records.projects.filter(project => project.bonsaiProjectId !== null && project.bonsaiProjectId !== undefined),
    project => String(project.bonsaiProjectId),
  );
  const users = workspaceExport.records.users;
  let matchedTasks = 0;
  const validSourceIds = new Set();

  for (const source of sourceTasks) {
    const sourceId = String(source?.uuid ?? '').trim();
    const projectSourceId = String(source?.project_id ?? '').trim();
    const projectMatches = projectsBySourceId.get(projectSourceId) ?? [];
    const ownerName = String(source?.assignee_member_name ?? '').trim();
    const ownerMatches = matchingUsers(users, ownerName);
    const expectedStatus = taskStatus(source);
    const expectedPriority = PRIORITY_MAP[normalized(source?.priority)];
    const dueDate = dateOnly(source?.due_date);
    const startDate = dateOnly(source?.start_date);
    const completedDate = dateOnly(source?.completed_at);
    const invalidFields = [];
    if (!sourceId) invalidFields.push('uuid');
    if (!normalized(source?.title)) invalidFields.push('title');
    if (!projectSourceId) invalidFields.push('project_id');
    if (projectMatches.length !== 1) invalidFields.push('project_identity');
    if (ownerName && ownerMatches.length !== 1) invalidFields.push('owner_identity');
    if (!expectedStatus) invalidFields.push('task_status');
    if (!expectedPriority) invalidFields.push('priority');
    if (source?.due_date && !dueDate) invalidFields.push('due_date');
    if (source?.start_date && !startDate) invalidFields.push('start_date');
    if (source?.completed_at && !completedDate) invalidFields.push('completed_at');
    if (source?.archived_at) invalidFields.push('archived_at');
    if (invalidFields.length > 0) {
      findings.push({ code: 'BONSAI_TASK_SOURCE_INVALID', sourceId, taskTitle: String(source?.title ?? '').trim(), fields: invalidFields });
      continue;
    }
    validSourceIds.add(sourceId);
    if (duplicateSourceIds.has(sourceId) || duplicateHubIds.has(sourceId)) continue;
    const hubMatches = hubGroups.get(sourceId) ?? [];
    if (hubMatches.length === 0) {
      findings.push({ code: 'BONSAI_TASK_MISSING_IN_HUB', sourceId, taskTitle: String(source.title).trim() });
      continue;
    }
    const hub = hubMatches[0];
    const mismatchedFields = [];
    if (String(hub.title ?? '').trim() !== String(source.title).trim()) mismatchedFields.push('title');
    if (hub.projectId !== projectMatches[0].id) mismatchedFields.push('project');
    if (hub.status !== expectedStatus) mismatchedFields.push('status');
    if (hub.priority !== expectedPriority) mismatchedFields.push('priority');
    if ((hub.assigneeId ?? null) !== (ownerMatches[0]?.id ?? null)) mismatchedFields.push('assignee');
    if (dateOnly(hub.dueDate) !== dueDate) mismatchedFields.push('dueDate');
    if (dateOnly(hub.startDate) !== startDate) mismatchedFields.push('startDate');
    if (dateOnly(hub.completedAt) !== completedDate) mismatchedFields.push('completedAt');
    if (mismatchedFields.length > 0) {
      findings.push({ code: 'TASK_FIELD_MISMATCH', sourceId, hubTaskId: hub.id, fields: mismatchedFields });
      continue;
    }
    matchedTasks += 1;
  }

  for (const [sourceId, tasks] of hubGroups) {
    if (duplicateHubIds.has(sourceId)) continue;
    if (!validSourceIds.has(sourceId)) {
      findings.push({ code: 'HUB_BONSAI_TASK_MISSING_IN_SOURCE', sourceId, hubTaskId: tasks[0].id, taskTitle: tasks[0].title });
    }
  }

  let historicalSummary = null;
  if (includesHistory) {
    const historicalMapping = mapBonsaiHistoricalTasks({
      taskRows: bonsaiHistoricalTaskRows,
      projectRows: bonsaiProjectRows,
      currentTasks: sourceTasks,
      shouldSkipClient: name => ['ashbi design', 'test client'].includes(normalized(name)),
    });
    findings.push(...historicalMapping.findings);
    const historicalHubGroups = new Map();
    for (const task of workspaceExport.records.tasks) {
      const sourceId = String(parseProperties(task.properties).bonsaiLegacyTaskId ?? '').trim();
      if (!sourceId) continue;
      historicalHubGroups.set(sourceId, [...(historicalHubGroups.get(sourceId) ?? []), task]);
    }
    const duplicateHistoricalHubIds = new Set();
    for (const [sourceId, tasks] of historicalHubGroups) {
      if (tasks.length > 1) {
        duplicateHistoricalHubIds.add(sourceId);
        findings.push({
          code: 'DUPLICATE_HUB_BONSAI_HISTORICAL_TASK_ID', sourceId,
          hubTaskIds: tasks.map(task => task.id).sort(),
        });
      }
    }
    const mappedById = new Map(historicalMapping.tasks.map(task => [task.sourceId, task]));
    let matchedHistoricalTasks = 0;
    for (const source of historicalMapping.tasks) {
      if (duplicateHistoricalHubIds.has(source.sourceId)) continue;
      const hubMatches = historicalHubGroups.get(source.sourceId) ?? [];
      if (hubMatches.length === 0) {
        findings.push({ code: 'BONSAI_HISTORICAL_TASK_MISSING_IN_HUB', sourceId: source.sourceId });
        continue;
      }
      const projectMatches = projectsBySourceId.get(source.projectSourceId) ?? [];
      const ownerMatches = matchingUsers(users, source.ownerName);
      const expectedParent = source.parentSourceId ? historicalHubGroups.get(source.parentSourceId) ?? [] : [];
      const hub = hubMatches[0];
      const hubProperties = parseProperties(hub.properties);
      const expectedProperties = {
        bonsaiLegacyTaskId: source.sourceId,
        bonsaiSource: 'native-task-export',
        ...source.evidence,
      };
      const mismatchedFields = [];
      if (projectMatches.length !== 1) mismatchedFields.push('project_identity');
      else if (hub.projectId !== projectMatches[0].id) mismatchedFields.push('project');
      if (source.ownerName && ownerMatches.length !== 1) mismatchedFields.push('owner_identity');
      else if ((hub.assigneeId ?? null) !== (ownerMatches[0]?.id ?? null)) mismatchedFields.push('assignee');
      if (hub.title !== source.title) mismatchedFields.push('title');
      if (hub.status !== source.status) mismatchedFields.push('status');
      if (hub.priority !== source.priority) mismatchedFields.push('priority');
      if (dateOnly(hub.startDate) !== dateOnly(source.startDate)) mismatchedFields.push('startDate');
      if (dateOnly(hub.dueDate) !== dateOnly(source.dueDate)) mismatchedFields.push('dueDate');
      if (timestamp(hub.createdAt) !== timestamp(source.createdAt)) mismatchedFields.push('createdAt');
      if ((hub.estimatedTime ?? null) !== (source.evidence.estimate ?? null)) mismatchedFields.push('estimatedTime');
      if (Object.entries(expectedProperties).some(([key, value]) => (hubProperties[key] ?? null) !== (value ?? null))) {
        mismatchedFields.push('properties');
      }
      if (source.parentSourceId) {
        if (expectedParent.length !== 1) mismatchedFields.push('parent_identity');
        else if (hub.parentId !== expectedParent[0].id) mismatchedFields.push('parent');
      } else if (hub.parentId !== null && hub.parentId !== undefined) mismatchedFields.push('parent');
      if (mismatchedFields.length > 0) {
        findings.push({
          code: 'HISTORICAL_TASK_FIELD_MISMATCH', sourceId: source.sourceId,
          hubTaskId: hub.id, fields: mismatchedFields,
        });
      } else {
        matchedHistoricalTasks += 1;
      }
    }
    for (const [sourceId, tasks] of historicalHubGroups) {
      if (!mappedById.has(sourceId) && !duplicateHistoricalHubIds.has(sourceId)) {
        findings.push({
          code: 'HUB_BONSAI_HISTORICAL_TASK_MISSING_IN_SOURCE', sourceId,
          hubTaskId: tasks[0].id,
        });
      }
    }
    historicalSummary = {
      sourceHistoricalTasks: bonsaiHistoricalTaskRows.length,
      mappedHistoricalTasks: historicalMapping.tasks.length,
      hubBonsaiHistoricalTasks: [...historicalHubGroups.values()].reduce((sum, tasks) => sum + tasks.length, 0),
      matchedHistoricalTasks,
    };
  }

  return {
    format: 'ashbi-bonsai-task-reconciliation',
    version: includesHistory ? 2 : 1,
    complete: findings.length === 0,
    organizationId,
    completedAt: new Date(completed).toISOString(),
    unresolvedFindings: findings.length,
    summary: {
      sourceTasks: sourceTasks.length,
      hubBonsaiTasks: [...hubGroups.values()].reduce((sum, tasks) => sum + tasks.length, 0),
      matchedTasks,
      ...(historicalSummary ?? {}),
    },
    findings,
    sourceEvidence: {
      tasksSha256: requireSha256(bonsaiTasksSha256, 'bonsaiTasksSha256'),
      taskRows: sourceTasks.length,
      capturedAt: new Date(captured).toISOString(),
      scope: bonsaiTaskSnapshot.scope,
      ...(includesHistory ? {
        historicalTasksSha256: requireSha256(bonsaiHistoricalTasksSha256, 'bonsaiHistoricalTasksSha256'),
        historicalTaskRows: bonsaiHistoricalTaskRows.length,
        historicalProjectsSha256: requireSha256(bonsaiProjectsSha256, 'bonsaiProjectsSha256'),
        historicalProjectRows: bonsaiProjectRows.length,
      } : {}),
    },
    workspaceEvidence: {
      artifactSha256: requireSha256(workspaceArtifactSha256, 'workspaceArtifactSha256'),
      recordsSha256: workspaceExport.manifest.recordsSha256,
      collectionCounts: Object.fromEntries(workspaceExportCollections(workspaceExport.version).map(collection => [
        collection,
        workspaceExport.manifest.collections[collection].count,
      ])),
    },
  };
}
