const REQUIRED_TASK_FIELDS = Object.freeze([
  'uuid',
  'title',
  'project_id',
  'project_title',
  'assignee_member_name',
  'due_date',
  'start_date',
  'completed_at',
  'archived_at',
  'priority',
  'task_status',
]);

const PRIORITIES = new Set([null, '', 'urgent', 'high', 'medium', 'low']);

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value) {
  return value === null || validTimestamp(value);
}

function taskFinding(task, index) {
  const fields = [];
  for (const field of REQUIRED_TASK_FIELDS) {
    if (!Object.hasOwn(task ?? {}, field)) fields.push(field);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text(task?.uuid))) {
    fields.push('uuid');
  }
  if (typeof task?.title !== 'string') fields.push('title');
  if (!(task?.project_id === null || Number.isSafeInteger(task?.project_id))) fields.push('project_id');
  if (!(task?.project_title === null || typeof task?.project_title === 'string')) fields.push('project_title');
  if (!(task?.assignee_member_name === null || typeof task?.assignee_member_name === 'string')) {
    fields.push('assignee_member_name');
  }
  for (const field of ['due_date', 'start_date', 'completed_at', 'archived_at']) {
    if (!nullableTimestamp(task?.[field])) fields.push(field);
  }
  if (!PRIORITIES.has(task?.priority ?? null)) fields.push('priority');
  if (!text(task?.task_status?.status)
    || !['active', 'complete'].includes(task?.task_status?.state)) {
    fields.push('task_status');
  }
  return fields.length === 0 ? null : {
    code: 'INVALID_TASK_RECORD',
    index,
    fields: [...new Set(fields)].sort(),
  };
}

function migrationFinding(task, index) {
  const fields = [];
  if (!text(task?.title)) fields.push('title');
  if (task?.project_id === null) fields.push('project_id');
  return fields.length === 0 ? null : {
    code: 'TASK_REQUIRES_SOURCE_REVIEW',
    index,
    taskUuid: text(task?.uuid) || null,
    fields,
  };
}

export function verifyBonsaiTaskSnapshot(snapshot) {
  const integrityFindings = [];
  const migrationFindings = [];
  if (snapshot?.format !== 'bonsai-task-snapshot') integrityFindings.push({ code: 'INVALID_FORMAT' });
  if (snapshot?.version !== 1) integrityFindings.push({ code: 'UNSUPPORTED_VERSION' });
  if (snapshot?.scope !== 'all') integrityFindings.push({ code: 'INCOMPLETE_SCOPE' });
  if (snapshot?.complete !== true) integrityFindings.push({ code: 'SNAPSHOT_NOT_COMPLETE' });
  if (!validTimestamp(snapshot?.capturedAt)) integrityFindings.push({ code: 'INVALID_CAPTURE_TIMESTAMP' });
  if (!Array.isArray(snapshot?.tasks)) integrityFindings.push({ code: 'TASKS_NOT_ARRAY' });

  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const capture = snapshot?.captureEvidence;
  if (capture?.connector !== 'bonsai'
    || capture?.operation !== 'list_tasks'
    || !Number.isSafeInteger(capture?.pageSize)
    || capture.pageSize < 1
    || capture.pageSize > 100
    || !Number.isSafeInteger(capture?.pagesFetched)
    || capture.pagesFetched < 1
    || capture?.finalHasMore !== false
    || capture?.taskCount !== tasks.length) {
    integrityFindings.push({ code: 'INVALID_PAGINATION_EVIDENCE' });
  }

  const seen = new Map();
  tasks.forEach((task, index) => {
    const finding = taskFinding(task, index);
    if (finding) integrityFindings.push(finding);
    const review = migrationFinding(task, index);
    if (review) migrationFindings.push(review);
    const uuid = text(task?.uuid);
    if (uuid) seen.set(uuid, [...(seen.get(uuid) ?? []), index]);
  });
  for (const [uuid, indexes] of seen) {
    if (indexes.length > 1) integrityFindings.push({ code: 'DUPLICATE_TASK_UUID', uuid, indexes });
  }

  return {
    valid: integrityFindings.length === 0,
    migrationReady: integrityFindings.length === 0 && migrationFindings.length === 0,
    format: snapshot?.format ?? null,
    version: snapshot?.version ?? null,
    scope: snapshot?.scope ?? null,
    capturedAt: validTimestamp(snapshot?.capturedAt)
      ? new Date(snapshot.capturedAt).toISOString()
      : null,
    taskCount: tasks.length,
    pagesFetched: Number.isSafeInteger(capture?.pagesFetched) ? capture.pagesFetched : null,
    findings: [...integrityFindings, ...migrationFindings],
    integrityFindings,
    migrationFindings,
  };
}
