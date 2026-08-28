const STATUSES = new Set(['active', 'completed', 'archived']);

function text(value) {
  return String(value ?? '').trim();
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function projectFinding(project, index) {
  const fields = [];
  if (!Number.isSafeInteger(project?.id) || project.id < 1) fields.push('id');
  if (typeof project?.title !== 'string') fields.push('title');
  if (!(project?.public_url_token === null || typeof project?.public_url_token === 'string')) fields.push('public_url_token');
  if (!(project?.number === null || typeof project?.number === 'string')) fields.push('number');
  if (!(project?.board_group_id === null || typeof project?.board_group_id === 'string')) fields.push('board_group_id');
  if (!(project?.company_name === null || typeof project?.company_name === 'string')) fields.push('company_name');
  if (typeof project?.url !== 'string' || !/^https:\/\/app\.hellobonsai\.com\/projects\/[a-z0-9]+$/i.test(project.url)) fields.push('url');
  if (!STATUSES.has(project?.status)) fields.push('status');
  return fields.length ? { code: 'INVALID_PROJECT_RECORD', index, fields: [...new Set(fields)].sort() } : null;
}

function migrationFinding(project, index) {
  const fields = [];
  if (!text(project?.title)) fields.push('title');
  if (!text(project?.company_name)) fields.push('company_name');
  return fields.length ? { code: 'PROJECT_REQUIRES_SOURCE_REVIEW', index, projectId: project?.id ?? null, fields } : null;
}

export function verifyBonsaiProjectSnapshot(snapshot) {
  const integrityFindings = [];
  const migrationFindings = [];
  if (snapshot?.format !== 'bonsai-project-snapshot') integrityFindings.push({ code: 'INVALID_FORMAT' });
  if (snapshot?.version !== 1) integrityFindings.push({ code: 'UNSUPPORTED_VERSION' });
  if (snapshot?.scope !== 'all') integrityFindings.push({ code: 'INCOMPLETE_SCOPE' });
  if (snapshot?.complete !== true) integrityFindings.push({ code: 'SNAPSHOT_NOT_COMPLETE' });
  if (!validTimestamp(snapshot?.capturedAt)) integrityFindings.push({ code: 'INVALID_CAPTURE_TIMESTAMP' });
  if (!Array.isArray(snapshot?.projects)) integrityFindings.push({ code: 'PROJECTS_NOT_ARRAY' });

  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const capture = snapshot?.captureEvidence;
  const lifecycleQueries = Array.isArray(capture?.lifecycleQueries) ? capture.lifecycleQueries : [];
  const capturedStatusCounts = new Map(lifecycleQueries.map(item => [item?.status, item?.projectCount]));
  const actualStatusCounts = new Map([...STATUSES].map(status => [status, projects.filter(project => project?.status === status).length]));
  const lifecycleValid = lifecycleQueries.length === STATUSES.size
    && [...STATUSES].every(status => {
      const item = lifecycleQueries.find(candidate => candidate?.status === status);
      return item
        && Number.isSafeInteger(item.pagesFetched) && item.pagesFetched >= 1
        && item.finalHasMore === false
        && Number.isSafeInteger(item.projectCount) && item.projectCount >= 0
        && item.projectCount === actualStatusCounts.get(status);
    });
  const expectedPages = projects.length === 0 ? 1 : Math.ceil(projects.length / (capture?.pageSize || 1));
  if (capture?.connector !== 'bonsai'
    || capture?.operation !== 'list_projects'
    || !Number.isSafeInteger(capture?.pageSize) || capture.pageSize < 1 || capture.pageSize > 100
    || !Number.isSafeInteger(capture?.allStatusPagesFetched) || capture.allStatusPagesFetched !== expectedPages
    || capture?.allStatusFinalHasMore !== false
    || capture?.projectCount !== projects.length
    || capture?.lifecyclePartitionComplete !== true
    || !lifecycleValid
    || [...capturedStatusCounts.values()].reduce((sum, count) => sum + count, 0) !== projects.length) {
    integrityFindings.push({ code: 'INVALID_PAGINATION_OR_LIFECYCLE_EVIDENCE' });
  }

  const ids = new Map();
  const tokens = new Map();
  projects.forEach((project, index) => {
    const finding = projectFinding(project, index);
    if (finding) integrityFindings.push(finding);
    const review = migrationFinding(project, index);
    if (review) migrationFindings.push(review);
    if (Number.isSafeInteger(project?.id)) ids.set(project.id, [...(ids.get(project.id) ?? []), index]);
    const token = text(project?.public_url_token);
    if (token) tokens.set(token, [...(tokens.get(token) ?? []), index]);
  });
  for (const [id, indexes] of ids) if (indexes.length > 1) integrityFindings.push({ code: 'DUPLICATE_PROJECT_ID', id, indexes });
  for (const [token, indexes] of tokens) if (indexes.length > 1) integrityFindings.push({ code: 'DUPLICATE_PUBLIC_URL_TOKEN', token, indexes });

  return {
    valid: integrityFindings.length === 0,
    migrationReady: integrityFindings.length === 0 && migrationFindings.length === 0,
    format: snapshot?.format ?? null,
    version: snapshot?.version ?? null,
    scope: snapshot?.scope ?? null,
    capturedAt: validTimestamp(snapshot?.capturedAt) ? new Date(snapshot.capturedAt).toISOString() : null,
    projectCount: projects.length,
    statusCounts: Object.fromEntries(actualStatusCounts),
    allStatusPagesFetched: Number.isSafeInteger(capture?.allStatusPagesFetched) ? capture.allStatusPagesFetched : null,
    findings: [...integrityFindings, ...migrationFindings],
    integrityFindings,
    migrationFindings,
  };
}
