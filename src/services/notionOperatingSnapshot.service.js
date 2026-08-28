export const NOTION_OPERATING_SOURCE = Object.freeze({
  hubPageId: '1d13a5e9-c171-8047-b652-e82892a0a2ee',
  projectsDatabaseId: '30bbe848-cb18-46d5-a87d-0b5eff1ad3f0',
  projectsDataSourceUrl: 'collection://813c5c53-0306-47cf-8702-4f5c252e6c93',
  tasksDatabaseId: 'f81c5ddc-1a48-4d5b-8fc9-411016061bb0',
  tasksDataSourceUrl: 'collection://61de8e85-ee57-435f-9244-bf563dc2709e',
  archivedProjectsDataSourceUrl: 'collection://1d13a5e9-c171-8181-9832-000b9c6f394a',
  archivedTasksDataSourceUrl: 'collection://1d13a5e9-c171-8101-844c-000b416b4337',
});

const PROJECT_STATUSES = new Set(['Active', 'Waiting', 'Planning', 'Done']);
const TASK_STATUSES = new Set(['To do', 'Doing', 'Review', 'Done']);

function text(value) {
  return String(value ?? '').trim();
}
function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function notionPageUrl(value) {
  return /^https:\/\/app\.notion\.com\/[0-9a-f]{32}$/i.test(text(value));
}

function parseRelation(value) {
  try {
    const parsed = JSON.parse(String(value ?? ''));
    return Array.isArray(parsed) && parsed.every(notionPageUrl) ? parsed : null;
  } catch {
    return null;
  }
}

function duplicateFindings(rows, field, code) {
  const groups = new Map();
  rows.forEach((row, index) => {
    const key = text(row?.[field]).toLowerCase();
    if (key) groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  return [...groups.entries()]
    .filter(([, indexes]) => indexes.length > 1)
    .map(([value, indexes]) => ({ code, value, indexes }));
}

export function verifyNotionOperatingSnapshot(snapshot) {
  const findings = [];
  if (snapshot?.format !== 'ashbi-notion-project-task-snapshot') findings.push({ code: 'INVALID_FORMAT' });
  if (snapshot?.version !== 1) findings.push({ code: 'UNSUPPORTED_VERSION' });
  if (snapshot?.complete !== true) findings.push({ code: 'SNAPSHOT_NOT_COMPLETE' });
  if (!validTimestamp(snapshot?.capturedAt)) findings.push({ code: 'INVALID_CAPTURE_TIMESTAMP' });

  const expected = NOTION_OPERATING_SOURCE;
  const sourceMatches = snapshot?.workspaceHub?.pageId === expected.hubPageId
    && snapshot?.sources?.projects?.databaseId === expected.projectsDatabaseId
    && snapshot?.sources?.projects?.dataSourceUrl === expected.projectsDataSourceUrl
    && snapshot?.sources?.tasks?.databaseId === expected.tasksDatabaseId
    && snapshot?.sources?.tasks?.dataSourceUrl === expected.tasksDataSourceUrl
    && snapshot?.archivedSources?.projectsDataSourceUrl === expected.archivedProjectsDataSourceUrl
    && snapshot?.archivedSources?.tasksDataSourceUrl === expected.archivedTasksDataSourceUrl;
  if (!sourceMatches) findings.push({ code: 'OPERATING_SOURCE_IDENTITY_MISMATCH' });

  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const tasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  if (!Array.isArray(snapshot?.projects)) findings.push({ code: 'PROJECTS_NOT_ARRAY' });
  if (!Array.isArray(snapshot?.tasks)) findings.push({ code: 'TASKS_NOT_ARRAY' });
  if (snapshot?.sources?.projects?.hasMore !== false
    || snapshot?.sources?.projects?.rows !== projects.length
    || snapshot?.sources?.tasks?.hasMore !== false
    || snapshot?.sources?.tasks?.rows !== tasks.length) {
    findings.push({ code: 'INCOMPLETE_QUERY_EVIDENCE' });
  }

  const projectUrls = new Set();
  projects.forEach((project, index) => {
    const fields = [];
    if (!notionPageUrl(project?.url)) fields.push('url');
    if (!validTimestamp(project?.createdTime)) fields.push('createdTime');
    if (!text(project?.Project)) fields.push('Project');
    if (!PROJECT_STATUSES.has(project?.Status)) fields.push('Status');
    if (fields.length > 0) findings.push({ code: 'INVALID_PROJECT_RECORD', index, fields });
    if (notionPageUrl(project?.url)) projectUrls.add(project.url);
  });
  findings.push(...duplicateFindings(projects, 'url', 'DUPLICATE_PROJECT_URL'));
  findings.push(...duplicateFindings(projects, 'Project', 'DUPLICATE_PROJECT_TITLE'));

  tasks.forEach((task, index) => {
    const fields = [];
    if (!notionPageUrl(task?.url)) fields.push('url');
    if (!validTimestamp(task?.createdTime)) fields.push('createdTime');
    if (!text(task?.Task)) fields.push('Task');
    if (!TASK_STATUSES.has(task?.Status)) fields.push('Status');
    const relation = parseRelation(task?.Project);
    if (!relation || relation.length !== 1) fields.push('Project');
    else if (!projectUrls.has(relation[0])) fields.push('Project target');
    if (fields.length > 0) findings.push({ code: 'INVALID_TASK_RECORD', index, fields });
  });
  findings.push(...duplicateFindings(tasks, 'url', 'DUPLICATE_TASK_URL'));
  findings.push(...duplicateFindings(tasks, 'Task', 'DUPLICATE_TASK_TITLE'));

  const countBy = (rows, field) => Object.fromEntries(
    [...new Set(rows.map(row => row?.[field] ?? null))]
      .map(value => [String(value), rows.filter(row => row?.[field] === value).length]),
  );
  const openTasks = tasks.filter(task => task.Status !== 'Done');
  const projectsWithOpenTasks = new Set(openTasks.flatMap(task => parseRelation(task.Project) ?? []));
  return {
    valid: findings.length === 0,
    format: snapshot?.format ?? null,
    version: snapshot?.version ?? null,
    capturedAt: validTimestamp(snapshot?.capturedAt) ? new Date(snapshot.capturedAt).toISOString() : null,
    summary: {
      projects: projects.length,
      projectStatuses: countBy(projects, 'Status'),
      tasks: tasks.length,
      openTasks: openTasks.length,
      taskStatuses: countBy(tasks, 'Status'),
      projectsWithoutOpenTasks: projects.filter(project => !projectsWithOpenTasks.has(project.url)).length,
    },
    findings,
  };
}
