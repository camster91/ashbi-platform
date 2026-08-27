import { verifyWorkspaceExport, workspaceExportCollections } from './workspace-export-integrity.service.js';
import { parseBonsaiMoney } from './bonsaiCsvValues.service.js';
import { mapBonsaiConnections } from './bonsaiConnectionMapper.service.js';

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

function isoDate(value) {
  const date = new Date(String(value ?? '').trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function durationMinutes(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(String(value ?? '').trim());
  return match ? (Number(match[1]) * 60) + Number(match[2]) : null;
}

function decimal(value) {
  const number = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(number) ? number : null;
}

function expenseCategory(tags) {
  const value = normalized(tags);
  if (value.includes('advertising')) return 'MARKETING';
  if (value.includes('professional services') || value.includes('subcontractors')) return 'SUBCONTRACTOR';
  if (value.includes('work devices') || value.includes('software') || value.includes('subscriptions')) return 'SOFTWARE';
  if (value.includes('business meals') || value.includes('client entertainment') || value.includes('flights') || value.includes('taxi') || value.includes('transportation')) return 'TRAVEL';
  if (value.includes('electronics') || value.includes('furniture')) return 'SUPPLIES';
  return 'OTHER';
}

function shouldSkipExpense(row) {
  const name = normalized(row.name);
  const tags = normalized(row.tags);
  return tags.includes('personal') || name.includes('personal')
    || name.includes('e-transfer sent cameron') || name.includes('e-transfer sent cam');
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

export function reconcileBonsaiOperations({
  organizationId,
  completedAt,
  bonsaiClientsSha256,
  bonsaiConnectionsSha256,
  bonsaiConnectionInvoicesSha256,
  bonsaiProjectsSha256,
  bonsaiTimeEntriesSha256,
  bonsaiExpensesSha256,
  workspaceArtifactSha256,
  bonsaiClientRows,
  bonsaiConnectionRows,
  bonsaiInvoiceRows,
  bonsaiProjectRows,
  bonsaiTimeEntryRows,
  bonsaiExpenseRows,
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
  const usesConnectionExport = Array.isArray(bonsaiConnectionRows);
  if ((!usesConnectionExport && !Array.isArray(bonsaiClientRows)) || !Array.isArray(bonsaiProjectRows)) {
    throw new TypeError('Bonsai source rows must be arrays');
  }
  if (usesConnectionExport && !Array.isArray(bonsaiInvoiceRows)) {
    throw new TypeError('Connections reconciliation requires Bonsai invoice rows');
  }
  const includesOperatingLedger = workspaceExport.version === 3;
  if (includesOperatingLedger && (!Array.isArray(bonsaiTimeEntryRows) || !Array.isArray(bonsaiExpenseRows))) {
    throw new TypeError('Version 3 reconciliation requires Bonsai time-entry and expense rows');
  }
  const clientRows = usesConnectionExport ? [] : bonsaiClientRows.filter(row => !shouldSkipClient(row.Client));
  const projectRows = bonsaiProjectRows.filter(row => !shouldSkipClient(row.client_or_company_name) && normalized(row.title));
  const connectionMapping = usesConnectionExport ? mapBonsaiConnections({
    connectionRows: bonsaiConnectionRows,
    projectRows: bonsaiProjectRows,
    invoiceRows: bonsaiInvoiceRows,
    shouldSkipClient,
  }) : null;

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
  const findings = connectionMapping ? [...connectionMapping.findings] : [];
  const sourceClientGroups = new Map();
  if (connectionMapping) {
    for (const mapped of connectionMapping.clients) {
      sourceClientGroups.set(normalized(mapped.name), [{
        Client: mapped.name,
        'Contact Email': mapped.primaryConnection?.email || '',
        mappedConnections: mapped.connections,
        invoiceEmails: mapped.invoiceEmails,
        mappedDomain: mapped.domain,
        primaryConnection: mapped.primaryConnection,
      }]);
    }
  } else {
    for (const row of clientRows) {
      const name = normalized(row.Client);
      sourceClientGroups.set(name, [...(sourceClientGroups.get(name) ?? []), row]);
    }
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
    } else if (usesConnectionExport) {
      const expectedEmails = new Set([
        ...(row.mappedConnections ?? []).map(connection => normalized(connection.email)),
        ...(row.invoiceEmails ?? []).map(normalized),
      ].filter(Boolean));
      const missingEmails = [...expectedEmails].filter(email => !hubEmails.has(email));
      const primary = row.primaryConnection;
      const mismatchedFields = [];
      if (missingEmails.length > 0) mismatchedFields.push('contacts');
      if (row.mappedDomain && normalized(client.domain) !== normalized(row.mappedDomain)) mismatchedFields.push('domain');
      if (primary?.name && normalized(client.contactPerson) !== normalized(primary.name)) mismatchedFields.push('contactPerson');
      if (mismatchedFields.length > 0) {
        findings.push({ code: 'CLIENT_CONNECTION_MISMATCH', clientName: client.name, fields: mismatchedFields });
      } else {
        matchedClients += 1;
      }
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

  let matchedTimeEntries = 0;
  let matchedExpenses = 0;
  let relevantTimeRows = [];
  let relevantExpenseRows = [];
  if (includesOperatingLedger) {
    relevantTimeRows = bonsaiTimeEntryRows.filter(row => !shouldSkipClient(row.client_name));
    relevantExpenseRows = bonsaiExpenseRows.filter(row => !shouldSkipExpense(row));
    const clientsByNormalizedName = groupBy(workspaceExport.records.clients, client => normalized(client.name));
    const projectsByClientAndName = groupBy(workspaceExport.records.projects, (project) => {
      const client = workspaceExport.records.clients.find(item => item.id === project.clientId);
      return `${normalized(client?.name)}|${normalized(project.name)}`;
    });
    const importedTimeEntries = workspaceExport.records.timeEntries.filter(entry => entry.source === 'BONSAI_IMPORT');
    const hubTimeGroups = groupBy(importedTimeEntries, entry => [
      entry.projectId, entry.userId, isoDate(entry.date), Number(entry.duration),
    ].join('|'));
    const seenSourceTimeKeys = new Set();
    const matchedHubTimeIds = new Set();

    for (const row of relevantTimeRows) {
      const invalidFields = [];
      const projectMatches = projectsByClientAndName.get(`${normalized(row.client_name)}|${normalized(row.project_title)}`) ?? [];
      const userMatches = matchingUsers(workspaceExport.records.users, row.owner_name);
      const date = isoDate(row.date);
      const duration = durationMinutes(row.formatted_time);
      const rateRaw = String(row.rate ?? '').trim();
      const parsedRate = rateRaw ? parseBonsaiMoney(rateRaw) : null;
      const expectedRate = parsedRate || null;
      if (!normalized(row.project_title)) invalidFields.push('project_title');
      if (projectMatches.length !== 1) invalidFields.push('project_identity');
      if (!normalized(row.owner_name) || userMatches.length !== 1) invalidFields.push('owner_identity');
      if (!date) invalidFields.push('date');
      if (!Number.isInteger(duration) || duration <= 0) invalidFields.push('formatted_time');
      if (rateRaw && parsedRate === null) invalidFields.push('rate');
      if (invalidFields.length > 0) {
        findings.push({
          code: 'BONSAI_TIME_ENTRY_SOURCE_INVALID', projectName: String(row.project_title ?? '').trim(),
          ownerName: String(row.owner_name ?? '').trim(), fields: invalidFields,
        });
        continue;
      }
      const key = [projectMatches[0].id, userMatches[0].id, date, duration].join('|');
      if (seenSourceTimeKeys.has(key)) {
        findings.push({ code: 'DUPLICATE_BONSAI_TIME_ENTRY_IDENTITY', projectName: String(row.project_title).trim(), ownerName: String(row.owner_name).trim(), date, duration });
        continue;
      }
      seenSourceTimeKeys.add(key);
      const hubMatches = hubTimeGroups.get(key) ?? [];
      if (hubMatches.length === 0) {
        findings.push({ code: 'BONSAI_TIME_ENTRY_MISSING_IN_HUB', projectName: String(row.project_title).trim(), ownerName: String(row.owner_name).trim(), date, duration });
        continue;
      }
      if (hubMatches.length > 1) {
        findings.push({ code: 'DUPLICATE_HUB_BONSAI_TIME_ENTRY_IDENTITY', hubTimeEntryIds: hubMatches.map(entry => entry.id).sort() });
        continue;
      }
      const hub = hubMatches[0];
      matchedHubTimeIds.add(hub.id);
      const expectedDescription = String(row.notes ?? '').trim() || `${String(row.project_title).trim()} work`;
      const mismatchedFields = [];
      if (hub.description !== expectedDescription) mismatchedFields.push('description');
      if (Boolean(hub.billable) !== (normalized(row.billing_status) === 'billed')) mismatchedFields.push('billable');
      if ((decimal(hub.hourlyRate) || null) !== expectedRate) mismatchedFields.push('hourlyRate');
      if (mismatchedFields.length > 0) {
        findings.push({ code: 'TIME_ENTRY_FIELD_MISMATCH', hubTimeEntryId: hub.id, fields: mismatchedFields });
        continue;
      }
      matchedTimeEntries += 1;
    }
    for (const entry of importedTimeEntries) {
      if (!matchedHubTimeIds.has(entry.id)) findings.push({ code: 'HUB_BONSAI_TIME_ENTRY_MISSING_IN_SOURCE', hubTimeEntryId: entry.id });
    }

    const hubExpenseGroups = groupBy(workspaceExport.records.expenses, expense => [
      normalized(expense.description), isoDate(expense.date), decimal(expense.amount)?.toFixed(2),
      String(expense.currency ?? '').toUpperCase(), expense.clientId ?? '', expense.projectId ?? '',
    ].join('|'));
    const seenSourceExpenseKeys = new Set();
    for (const row of relevantExpenseRows) {
      const invalidFields = [];
      const clientMatches = normalized(row.client) ? (clientsByNormalizedName.get(normalized(row.client)) ?? []) : [];
      const projectMatches = normalized(row.project) && normalized(row.client)
        ? (projectsByClientAndName.get(`${normalized(row.client)}|${normalized(row.project)}`) ?? []) : [];
      const amount = parseBonsaiMoney(row.amount_after_tax || row.amount_pre_tax);
      const date = isoDate(row.date);
      const currency = String(row.currency ?? '').trim().toUpperCase();
      if (!normalized(row.name)) invalidFields.push('name');
      if (amount === null || amount === 0) invalidFields.push('amount');
      if (!date) invalidFields.push('date');
      if (!['CAD', 'USD'].includes(currency)) invalidFields.push('currency');
      if (normalized(row.client) && clientMatches.length !== 1) invalidFields.push('client_identity');
      if (normalized(row.project) && projectMatches.length !== 1) invalidFields.push('project_identity');
      if (invalidFields.length > 0) {
        findings.push({ code: 'BONSAI_EXPENSE_SOURCE_INVALID', description: String(row.name ?? '').trim(), fields: invalidFields });
        continue;
      }
      const clientId = clientMatches[0]?.id ?? '';
      const projectId = projectMatches[0]?.id ?? '';
      const key = [normalized(row.name), date, amount.toFixed(2), currency, clientId, projectId].join('|');
      if (seenSourceExpenseKeys.has(key)) {
        findings.push({ code: 'DUPLICATE_BONSAI_EXPENSE_IDENTITY', description: String(row.name).trim(), date, amount, currency });
        continue;
      }
      seenSourceExpenseKeys.add(key);
      const hubMatches = hubExpenseGroups.get(key) ?? [];
      if (hubMatches.length === 0) {
        findings.push({ code: 'BONSAI_EXPENSE_MISSING_IN_HUB', description: String(row.name).trim(), date, amount, currency });
        continue;
      }
      if (hubMatches.length > 1) {
        findings.push({ code: 'DUPLICATE_HUB_BONSAI_EXPENSE_IDENTITY', hubExpenseIds: hubMatches.map(expense => expense.id).sort() });
        continue;
      }
      const hub = hubMatches[0];
      const mismatchedFields = [];
      if (hub.description !== String(row.name).trim()) mismatchedFields.push('description');
      if (hub.category !== expenseCategory(row.tags)) mismatchedFields.push('category');
      if (Boolean(hub.billable) !== (normalized(row.billable) === 'true')) mismatchedFields.push('billable');
      if (mismatchedFields.length > 0) {
        findings.push({ code: 'EXPENSE_FIELD_MISMATCH', hubExpenseId: hub.id, fields: mismatchedFields });
        continue;
      }
      matchedExpenses += 1;
    }
  }

  return {
    format: 'ashbi-bonsai-operations-reconciliation',
    version: usesConnectionExport && includesOperatingLedger ? 3 : includesOperatingLedger ? 2 : 1,
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
      ...(connectionMapping ? { connectionMapping: connectionMapping.summary } : {}),
      ...(includesOperatingLedger ? {
        sourceTimeEntries: relevantTimeRows.length,
        matchedTimeEntries,
        sourceExpenses: relevantExpenseRows.length,
        matchedExpenses,
      } : {}),
    },
    findings,
    sourceEvidence: {
      ...(usesConnectionExport ? {
        connectionsSha256: requireSha256(bonsaiConnectionsSha256, 'bonsaiConnectionsSha256'),
        connectionRows: bonsaiConnectionRows.length,
        connectionInvoicesSha256: requireSha256(bonsaiConnectionInvoicesSha256, 'bonsaiConnectionInvoicesSha256'),
        connectionInvoiceRows: bonsaiInvoiceRows.length,
      } : {
        clientsSha256: requireSha256(bonsaiClientsSha256, 'bonsaiClientsSha256'),
        clientRows: bonsaiClientRows.length,
      }),
      projectsSha256: requireSha256(bonsaiProjectsSha256, 'bonsaiProjectsSha256'),
      projectRows: bonsaiProjectRows.length,
      ...(includesOperatingLedger ? {
        timeEntriesSha256: requireSha256(bonsaiTimeEntriesSha256, 'bonsaiTimeEntriesSha256'),
        timeEntryRows: bonsaiTimeEntryRows.length,
        expensesSha256: requireSha256(bonsaiExpensesSha256, 'bonsaiExpensesSha256'),
        expenseRows: bonsaiExpenseRows.length,
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
