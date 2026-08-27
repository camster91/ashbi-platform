import { verifyWorkspaceExport, workspaceExportCollections } from './workspace-export-integrity.service.js';

const PROJECT_STATUS_MAP = Object.freeze({
  active: 'DESIGN_DEV',
  completed: 'LAUNCHED',
  archived: 'ON_HOLD',
});
const SKIP_CLIENTS = new Set([
  'test', 'test client', 'cameron ashley', 'cam ashley', 'ashbi design',
  'bianca ashley', 'bianca bien-aime ashley', 'demo', 'sample',
  'test project', 'example',
]);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function shouldSkipClient(value) {
  const name = normalized(value);
  return !name || SKIP_CLIENTS.has(name) || name.startsWith('test ');
}

function requireSha256(value, name) {
  if (!/^[a-f0-9]{64}$/i.test(String(value ?? ''))) throw new TypeError(`${name} must be a SHA-256 digest`);
  return value.toLowerCase();
}

export function reconcileBonsaiOperations({
  organizationId,
  completedAt,
  bonsaiClientsSha256,
  bonsaiProjectsSha256,
  workspaceArtifactSha256,
  bonsaiClientRows,
  bonsaiProjectRows,
  workspaceExport,
}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) throw new TypeError('organizationId is required');
  if (workspaceExport?.organization?.id !== organizationId || !verifyWorkspaceExport(workspaceExport).valid) {
    throw new TypeError('A valid tenant-matched workspace export is required');
  }
  const completed = new Date(completedAt);
  const exported = new Date(workspaceExport.exportedAt);
  if (Number.isNaN(completed.getTime())) throw new TypeError('completedAt must be a valid date');
  if (Number.isNaN(exported.getTime())) throw new TypeError('workspace export must include a valid exportedAt');
  if (completed < exported) throw new TypeError('completedAt must not predate the workspace export');
  if (!Array.isArray(bonsaiClientRows) || !Array.isArray(bonsaiProjectRows)) throw new TypeError('Bonsai source rows must be arrays');
  const clientRows = bonsaiClientRows.filter(row => !shouldSkipClient(row.Client));
  const projectRows = bonsaiProjectRows.filter(row => !shouldSkipClient(row.client_or_company_name) && normalized(row.title));

  const hubClientGroups = new Map();
  for (const client of workspaceExport.records.clients) {
    const name = normalized(client.name);
    hubClientGroups.set(name, [...(hubClientGroups.get(name) ?? []), client]);
  }
  const clientsByName = new Map([...hubClientGroups].map(([name, clients]) => [name, clients[0]]));
  const emailsByClient = new Map();
  for (const contact of workspaceExport.records.contacts.filter(item => item.email)) {
    const email = normalized(contact.email);
    emailsByClient.set(contact.clientId, new Set([...(emailsByClient.get(contact.clientId) ?? []), email]));
  }
  const hubProjectGroups = new Map();
  for (const project of workspaceExport.records.projects.filter(item => item.bonsaiProjectId)) {
    const sourceId = String(project.bonsaiProjectId);
    hubProjectGroups.set(sourceId, [...(hubProjectGroups.get(sourceId) ?? []), project]);
  }
  const projectsByBonsaiId = new Map([...hubProjectGroups].map(([sourceId, projects]) => [sourceId, projects[0]]));
  const findings = [];
  const sourceClientGroups = new Map();
  for (const row of clientRows) {
    const name = normalized(row.Client);
    sourceClientGroups.set(name, [...(sourceClientGroups.get(name) ?? []), row]);
  }
  for (const row of projectRows) {
    const name = normalized(row.client_or_company_name);
    if (!sourceClientGroups.has(name)) {
      sourceClientGroups.set(name, [{ Client: String(row.client_or_company_name).trim(), 'Contact Email': '' }]);
    }
  }
  const ambiguousClientNames = new Set();
  for (const [name, rows] of sourceClientGroups) {
    if (rows.length > 1) {
      ambiguousClientNames.add(name);
      findings.push({ code: 'DUPLICATE_BONSAI_CLIENT_IDENTITY', clientName: String(rows[0].Client).trim(), rows: rows.length });
    }
  }
  for (const [name, clients] of hubClientGroups) {
    if (sourceClientGroups.has(name) && clients.length > 1) {
      ambiguousClientNames.add(name);
      findings.push({ code: 'DUPLICATE_HUB_CLIENT_IDENTITY', clientName: name, hubClientIds: clients.map(client => client.id).sort() });
    }
  }
  let matchedClients = 0;
  for (const [clientName, rows] of sourceClientGroups) {
    const row = rows[0];
    if (ambiguousClientNames.has(clientName)) continue;
    const client = clientsByName.get(clientName);
    const bonsaiEmail = normalized(row['Contact Email']);
    const hubEmails = client ? new Set([...(emailsByClient.get(client.id) ?? []), normalized(client.email)].filter(Boolean)) : new Set();
    const hubEmail = [...hubEmails].sort()[0] ?? '';
    if (!client) {
      findings.push({ code: 'BONSAI_CLIENT_MISSING_IN_HUB', clientName: String(row.Client ?? '').trim() });
    } else if (bonsaiEmail && !hubEmails.has(bonsaiEmail)) {
      findings.push({ code: 'CLIENT_EMAIL_MISMATCH', clientName: client.name, bonsai: bonsaiEmail, hub: hubEmail || null });
    } else {
      matchedClients += 1;
    }
  }
  let matchedProjects = 0;
  const sourceProjectCounts = new Map();
  for (const row of projectRows) {
    const sourceId = String(row.project_id ?? '').trim();
    if (!sourceId) continue;
    sourceProjectCounts.set(sourceId, (sourceProjectCounts.get(sourceId) ?? 0) + 1);
  }
  const ambiguousProjectIds = new Set();
  for (const [sourceId, rows] of sourceProjectCounts) {
    if (rows > 1) {
      ambiguousProjectIds.add(sourceId);
      findings.push({ code: 'DUPLICATE_BONSAI_PROJECT_ID', sourceId, rows });
    }
  }
  for (const [sourceId, projects] of hubProjectGroups) {
    if (projects.length > 1) {
      ambiguousProjectIds.add(sourceId);
      findings.push({
        code: 'DUPLICATE_HUB_BONSAI_PROJECT_ID', sourceId, hubProjectIds: projects.map(project => project.id).sort(),
      });
    }
  }
  const sourceProjectIds = new Set();
  for (const row of projectRows) {
    const sourceId = String(row.project_id ?? '').trim();
    sourceProjectIds.add(sourceId);
    const expectedStatus = PROJECT_STATUS_MAP[normalized(row.status)];
    const invalidFields = [];
    if (!sourceId) invalidFields.push('project_id');
    if (!expectedStatus) invalidFields.push('status');
    if (invalidFields.length > 0) {
      findings.push({
        code: 'BONSAI_PROJECT_SOURCE_INVALID', sourceId, projectName: String(row.title ?? '').trim(), fields: invalidFields,
      });
      continue;
    }
    if (ambiguousProjectIds.has(sourceId)) continue;
    const project = projectsByBonsaiId.get(sourceId);
    const client = project ? workspaceExport.records.clients.find(item => item.id === project.clientId) : null;
    if (!project) {
      findings.push({ code: 'BONSAI_PROJECT_MISSING_IN_HUB', sourceId, projectName: String(row.title ?? '').trim() });
    }
    if (project && normalized(project.name) !== normalized(row.title)) {
      findings.push({ code: 'PROJECT_NAME_MISMATCH', sourceId, bonsai: String(row.title ?? '').trim(), hub: project.name });
    }
    if (project && normalized(client?.name) !== normalized(row.client_or_company_name)) {
      findings.push({ code: 'PROJECT_CLIENT_MISMATCH', sourceId, bonsai: String(row.client_or_company_name ?? '').trim(), hub: client?.name ?? null });
    }
    if (project && project.status !== expectedStatus) {
      findings.push({ code: 'PROJECT_STATUS_MISMATCH', sourceId, bonsai: expectedStatus ?? null, hub: project.status });
    }
    if (project
      && normalized(project.name) === normalized(row.title)
      && normalized(client?.name) === normalized(row.client_or_company_name)
      && project.status === expectedStatus) {
      matchedProjects += 1;
    }
  }
  for (const [sourceId, project] of projectsByBonsaiId) {
    if (ambiguousProjectIds.has(sourceId)) continue;
    if (!sourceProjectIds.has(sourceId)) {
      findings.push({
        code: 'HUB_BONSAI_PROJECT_MISSING_IN_SOURCE', sourceId, projectName: project.name, hubProjectId: project.id,
      });
    }
  }

  return {
    format: 'ashbi-bonsai-operations-reconciliation',
    version: 1,
    complete: findings.length === 0,
    organizationId,
    completedAt: completed.toISOString(),
    unresolvedFindings: findings.length,
    summary: {
      sourceClients: sourceClientGroups.size,
      matchedClients,
      sourceProjects: projectRows.length,
      hubBonsaiProjects: [...hubProjectGroups.values()].reduce((sum, projects) => sum + projects.length, 0),
      matchedProjects,
    },
    findings,
    sourceEvidence: {
      clientsSha256: requireSha256(bonsaiClientsSha256, 'bonsaiClientsSha256'),
      clientRows: bonsaiClientRows.length,
      projectsSha256: requireSha256(bonsaiProjectsSha256, 'bonsaiProjectsSha256'),
      projectRows: bonsaiProjectRows.length,
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
