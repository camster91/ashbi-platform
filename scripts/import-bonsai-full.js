#!/usr/bin/env node

/**
 * Bonsai → Agency Hub Full Import Script
 *
 * Imports: Clients, Contacts, Projects, Tasks, Invoices, Time Entries, Expenses
 * from Bonsai CSV exports plus a complete authenticated task snapshot.
 *
 * Usage:
 *   node scripts/import-bonsai-full.js --dry-run --organization-id <id> --connections-csv ./connection_export.csv --projects-csv ./project_export.csv --projects-json ./projects.json --tasks-csv ./task_export.csv --tasks-json ./tasks.json --invoices-csv ./invoice_export.csv --time-entries-csv ./time_export.csv --expenses-csv ./expense_export.csv --addresses-csv ./addresses.csv --summary-file ./reconciliation.json
 *   node scripts/import-bonsai-full.js --confirm --organization-id <id> --connections-csv ./connection_export.csv --projects-csv ./project_export.csv --projects-json ./projects.json --tasks-csv ./task_export.csv --tasks-json ./tasks.json --invoices-csv ./invoice_export.csv --time-entries-csv ./time_export.csv --expenses-csv ./expense_export.csv --addresses-csv ./addresses.csv --approved-summary ./reviewed-dry-run.json --summary-file ./live-reconciliation.json
 *
 * Reconciliation-first and replay-safe. Existing Hub records are matched but
 * never automatically overwritten. Natural/source identities are checked on:
 *   - Clients: by email or name
 *   - Projects: by bonsaiProjectId
 *   - Tasks: by Bonsai UUID stored in task properties
 *   - Invoices: by invoiceNumber
 *   - Time entries: by date + project + duration + user
 *   - Expenses: by description + date + amount
 */

// Prisma 7 ESM + driver adapter setup.
import prismaPkg from '@prisma/client';
const { PrismaClient } = prismaPkg;
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';
import { assertApprovedBonsaiDryRun, fingerprintBonsaiPlan, fingerprintInputInventory, missingRequiredCsvHeaders, sourceDifferences } from '../src/services/bonsai-import-evidence.service.js';
import { parseBonsaiMoney, parseBonsaiDecimal } from '../src/services/bonsaiCsvValues.service.js';
import { mapBonsaiConnections } from '../src/services/bonsaiConnectionMapper.service.js';
import { mapBonsaiHistoricalTasks } from '../src/services/bonsaiHistoricalTaskMapper.service.js';
import { assessMigrationSandboxTarget } from '../src/services/migrationSandboxTarget.service.js';
import { assessBonsaiOperatingSourceRecord, verifyBonsaiProjectCsvSnapshotBinding } from '../src/services/bonsaiOperatingSourceRegistry.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const DRY_RUN = process.argv.includes('--dry-run');
const CONFIRM_LIVE = process.argv.includes('--confirm');

function readOption(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const CSV_DIR = path.resolve(readOption('--csv-dir', process.env.BONSAI_CSV_DIR || path.join(__dirname, '..', 'data', 'bonsai-export')));
const SUMMARY_FILE = readOption('--summary-file');
const APPROVED_SUMMARY_FILE = readOption('--approved-summary');
const ORGANIZATION_ID = readOption('--organization-id', process.env.IMPORT_ORGANIZATION_ID);
const TASK_SNAPSHOT_FILE = readOption('--tasks-json', process.env.BONSAI_TASK_SNAPSHOT);
const PROJECT_SNAPSHOT_FILE = readOption('--projects-json', process.env.BONSAI_PROJECT_SNAPSHOT);
const TASK_EXPORT_FILE = readOption('--tasks-csv', process.env.BONSAI_TASK_EXPORT);
const CONNECTIONS_CSV_FILE = readOption('--connections-csv', process.env.BONSAI_CONNECTIONS_CSV);
const PROJECTS_CSV_FILE = readOption('--projects-csv', process.env.BONSAI_PROJECTS_CSV);
const INVOICES_CSV_FILE = readOption('--invoices-csv', process.env.BONSAI_INVOICES_CSV);
const TIME_ENTRIES_CSV_FILE = readOption('--time-entries-csv', process.env.BONSAI_TIME_ENTRIES_CSV);
const EXPENSES_CSV_FILE = readOption('--expenses-csv', process.env.BONSAI_EXPENSES_CSV);
const ADDRESSES_CSV_FILE = readOption('--addresses-csv', process.env.BONSAI_ADDRESSES_CSV);

if (DRY_RUN && CONFIRM_LIVE) {
  console.error('Choose exactly one import mode: --dry-run or --confirm.');
  process.exit(2);
}
if (!DRY_RUN && !CONFIRM_LIVE) {
  console.error('Refusing live import without --confirm. Use --dry-run first and review the reconciliation summary.');
  process.exit(2);
}
if (!ORGANIZATION_ID) {
  console.error('Refusing import without --organization-id (or IMPORT_ORGANIZATION_ID). Imports must be explicitly tenant-scoped.');
  process.exit(2);
}
if (!DRY_RUN && !APPROVED_SUMMARY_FILE) {
  console.error('Refusing live import without --approved-summary pointing to the reviewed dry-run report.');
  process.exit(2);
}
if (!SUMMARY_FILE) {
  console.error('Refusing import without --summary-file. Migration evidence is required.');
  process.exit(2);
}
if (!TASK_SNAPSHOT_FILE) {
  console.error('Refusing import without --tasks-json pointing to a complete all-scope Bonsai task snapshot.');
  process.exit(2);
}
if (!PROJECT_SNAPSHOT_FILE) {
  console.error('Refusing import without --projects-json pointing to a complete all-scope Bonsai project snapshot.');
  process.exit(2);
}
if (!TASK_EXPORT_FILE) {
  console.error('Refusing import without --tasks-csv pointing to the native Bonsai historical task export.');
  process.exit(2);
}

const sandboxTarget = assessMigrationSandboxTarget({
  environment: process.env,
  organizationId: ORGANIZATION_ID,
  requireMutationAuthorization: CONFIRM_LIVE,
});
if (!sandboxTarget.ready) {
  console.error(JSON.stringify({
    ready: false,
    environmentKind: sandboxTarget.environmentKind,
    checks: sandboxTarget.checks,
  }, null, 2));
  console.error('Refusing Bonsai import because the selected destination is not a fully bound sandbox target.');
  process.exit(2);
}

const summaryDestination = path.resolve(SUMMARY_FILE);
const summaryDescriptor = fs.openSync(summaryDestination, 'wx', 0o600);
let summaryWritten = false;
fs.writeFileSync(summaryDescriptor, `${JSON.stringify({
  generatedAt: new Date().toISOString(), mode: DRY_RUN ? 'dry-run' : 'live', state: 'RESERVED', complete: false,
})}\n`, 'utf8');

// === CSV Directory ===
// Override with --csv-dir or BONSAI_CSV_DIR; never depend on a developer machine path.

// === Skip list for test/dummy clients ===
const SKIP_CLIENTS = new Set([
  'test', 'test client', 'cameron ashley', 'cam ashley', 'ashbi design',
  'bianca ashley', 'bianca bien-aime ashley', 'demo', 'sample',
  'test project', 'example'
]);

function shouldSkipClient(name) {
  if (!name) return true;
  const lower = name.trim().toLowerCase();
  return SKIP_CLIENTS.has(lower) || lower.startsWith('test ') || lower === '';
}

// === CSV Reader ===
function readCSV(filename, explicitPath = null, kind = filename) {
  return new Promise((resolve, reject) => {
    const results = [];
    let headers = [];
    const filePath = explicitPath ? path.resolve(explicitPath) : path.join(CSV_DIR, filename);
    const evidenceFilename = explicitPath ? path.basename(filePath) : filename;
    if (!fs.existsSync(filePath)) {
      inputInventory.push({ filename: evidenceFilename, kind, path: filePath, present: false, rows: 0, sha256: null, headers: [] });
      console.log(`  ⚠ File not found: ${filePath}`);
      resolve([]);
      return;
    }
    const sourceBytes = fs.readFileSync(filePath);
    Readable.from(sourceBytes)
      .pipe(csvParser())
      .on('headers', (sourceHeaders) => { headers = sourceHeaders; })
      .on('data', (row) => results.push(row))
      .on('end', () => {
        const sha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
        inputInventory.push({ filename: evidenceFilename, kind, path: filePath, present: true, rows: results.length, sha256, headers });
        resolve(results);
      })
      .on('error', reject);
  });
}

// === Status Mappings ===
function mapProjectStatus(bonsaiStatus) {
  switch (bonsaiStatus?.toLowerCase()) {
    case 'active': return 'DESIGN_DEV';
    case 'completed': return 'LAUNCHED';
    case 'archived': return 'ON_HOLD';
    default: return null;
  }
}

function mapInvoiceStatus(bonsaiStatus) {
  switch (bonsaiStatus?.toLowerCase()) {
    case 'paid': return 'PAID';
    case 'overdue': return 'OVERDUE';
    case 'drafted': return 'DRAFT';
    case 'draft': return 'DRAFT';
    case 'scheduled': return 'DRAFT';
    case 'sent': return 'SENT';
    case 'void': return 'VOID';
    default: return null;
  }
}

function mapTaskStatus(task) {
  const state = (task?.task_status?.state || '').trim().toLowerCase();
  const label = (task?.task_status?.status || '').trim().toLowerCase();
  if (state === 'complete') return 'COMPLETED';
  if (state !== 'active') return null;
  if (label.includes('blocked') || label.includes('waiting')) return 'BLOCKED';
  if (label.includes('progress') || label === 'doing') return 'IN_PROGRESS';
  return 'PENDING';
}

function mapTaskPriority(priority) {
  switch ((priority || '').trim().toLowerCase()) {
    case 'urgent': return 'CRITICAL';
    case 'high': return 'HIGH';
    case 'medium': return 'NORMAL';
    case 'low': return 'LOW';
    case '': return 'NORMAL';
    default: return null;
  }
}

function parseTaskProperties(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function mapPaymentMethod(bonsaiMethod) {
  switch (bonsaiMethod?.toLowerCase()) {
    case 'credit_card': return 'OTHER';
    case 'ach': return 'BANK';
    case 'bank_transfer': return 'BANK';
    case 'marked_as_paid': return 'OTHER';
    case 'paypal': return 'OTHER';
    default: return bonsaiMethod ? 'OTHER' : null;
  }
}

function mapExpenseCategory(bonsaiTags) {
  const tags = (bonsaiTags || '').toLowerCase();
  if (tags.includes('payment processing')) return 'OTHER';
  if (tags.includes('advertising')) return 'MARKETING';
  if (tags.includes('professional services')) return 'SUBCONTRACTOR';
  if (tags.includes('work devices') || tags.includes('software') || tags.includes('subscriptions')) return 'SOFTWARE';
  if (tags.includes('subcontractors')) return 'SUBCONTRACTOR';
  if (tags.includes('education')) return 'OTHER';
  if (tags.includes('business meals') || tags.includes('client entertainment')) return 'TRAVEL';
  if (tags.includes('flights') || tags.includes('taxi') || tags.includes('transportation')) return 'TRAVEL';
  if (tags.includes('business insurance')) return 'OTHER';
  if (tags.includes('electronics') || tags.includes('furniture')) return 'SUPPLIES';
  return 'OTHER';
}

// === Time Parsing ===
function parseFormattedTime(formatted) {
  // HH:MM:SS → minutes
  if (!formatted) return 0;
  const parts = formatted.split(':');
  if (parts.length !== 3) return 0;
  const hours = parseInt(parts[0], 10) || 0;
  const mins = parseInt(parts[1], 10) || 0;
  return hours * 60 + mins;
}

function parseDate(dateStr) {
  if (!dateStr || dateStr.trim() === '') return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

// === Extract Bonsai ID from URL ===
function extractBonsaiId(url) {
  if (!url) return null;
  // https://app.hellobonsai.com/invoices/1364263
  const match = url.match(/\/(\d+)$/);
  return match ? match[1] : null;
}

// === Stats ===
const stats = {
  clients: { created: 0, existing: 0, skipped: 0 },
  contacts: { created: 0, existing: 0 },
  projects: { created: 0, existing: 0, skipped: 0 },
  tasks: { created: 0, existing: 0, skipped: 0 },
  historicalTasks: { created: 0, existing: 0, skipped: 0, parentsLinked: 0 },
  invoices: { created: 0, existing: 0, skipped: 0 },
  lineItems: { created: 0 },
  timeEntries: { created: 0, existing: 0, skipped: 0 },
  expenses: { created: 0, skipped: 0 },
  owners: { mappedToImporter: 0 },
  operatingSourceRecords: { created: 0, existing: 0, conflicts: 0 },
  errors: []
};
const inputInventory = [];

function writeSummary(reconciliation) {
  fs.ftruncateSync(summaryDescriptor, 0);
  fs.writeFileSync(summaryDescriptor, `${JSON.stringify(reconciliation, null, 2)}\n`, 'utf8');
  summaryWritten = true;
  console.log(`  Reconciliation summary: ${summaryDestination}`);
}

// ======================================================================
// MAIN
// ======================================================================
async function main() {
  const reconciliation = DRY_RUN
    ? await runImport(prisma)
    : await prisma.$transaction((transaction) => runImport(transaction), { timeout: 300_000 });
  writeSummary(reconciliation);
}

async function runImport(prisma) {
  const organization = await prisma.organization.findUnique({ where: { id: ORGANIZATION_ID }, select: { id: true, name: true } });
  if (!organization) throw new Error(`Organization not found: ${ORGANIZATION_ID}`);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Bonsai → Hub Full Import ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);
  console.log(`  Organization: ${organization.name} (${organization.id})`);

  // Load all CSVs
  console.log('📂 Loading CSVs...');
  const [clientsRaw, projectsRaw, historicalTasksRaw, invoicesRaw, timeEntriesRaw, expensesRaw, addressesRaw] = await Promise.all([
    readCSV('clients.csv', CONNECTIONS_CSV_FILE, 'connections'),
    readCSV('projects.csv', PROJECTS_CSV_FILE, 'projects.csv'),
    readCSV('tasks.csv', TASK_EXPORT_FILE, 'task-history'),
    readCSV('invoices.csv', INVOICES_CSV_FILE, 'invoices.csv'),
    readCSV('time-entries.csv', TIME_ENTRIES_CSV_FILE, 'time-entries.csv'),
    readCSV('expenses.csv', EXPENSES_CSV_FILE, 'expenses.csv'),
    readCSV('addresses.csv', ADDRESSES_CSV_FILE, 'addresses.csv'),
  ]);
  const taskSnapshotPath = path.resolve(TASK_SNAPSHOT_FILE);
  const taskSnapshotBytes = fs.readFileSync(taskSnapshotPath);
  const taskSnapshot = JSON.parse(taskSnapshotBytes.toString('utf8'));
  if (taskSnapshot?.format !== 'bonsai-task-snapshot' || taskSnapshot?.version !== 1
    || taskSnapshot?.scope !== 'all' || taskSnapshot?.complete !== true || !Array.isArray(taskSnapshot?.tasks)
    || !parseDate(taskSnapshot?.capturedAt)) {
    throw new TypeError('A complete all-scope Bonsai task snapshot version 1 with capturedAt is required');
  }
  const tasksRaw = taskSnapshot.tasks;
  inputInventory.push({
    filename: 'bonsai-tasks.json', kind: 'bonsai-tasks.json', path: taskSnapshotPath, present: true, rows: tasksRaw.length,
    sha256: crypto.createHash('sha256').update(taskSnapshotBytes).digest('hex'), headers: [],
  });
  const taskSnapshotSha256 = inputInventory.find(file => file.kind === 'bonsai-tasks.json').sha256;
  const projectSnapshotPath = path.resolve(PROJECT_SNAPSHOT_FILE);
  const projectSnapshotBytes = fs.readFileSync(projectSnapshotPath);
  const projectSnapshot = JSON.parse(projectSnapshotBytes.toString('utf8'));
  const projectSnapshotSha256 = crypto.createHash('sha256').update(projectSnapshotBytes).digest('hex');
  const projectBinding = verifyBonsaiProjectCsvSnapshotBinding({
    snapshot: projectSnapshot, snapshotSha256: projectSnapshotSha256, projectRows: projectsRaw,
  });
  inputInventory.push({
    filename: 'bonsai-projects.json', kind: 'bonsai-projects.json', path: projectSnapshotPath, present: true,
    rows: Array.isArray(projectSnapshot?.projects) ? projectSnapshot.projects.length : 0,
    sha256: projectSnapshotSha256, headers: [],
  });
  for (const finding of projectBinding.findings) {
    stats.errors.push(`Bonsai project snapshot: ${finding.code}${finding.sourceId ? ` (${finding.sourceId})` : ''}`);
  }

  const connectionInventory = inputInventory.find(file => file.kind === 'connections');
  const usesConnectionExport = connectionInventory?.headers?.includes('Name')
    && connectionInventory.headers.includes('Email');
  console.log(`  ${connectionInventory?.filename || 'clients.csv'}: ${clientsRaw.length} rows`);
  console.log(`  ${inputInventory.find(file => file.kind === 'projects.csv')?.filename || 'projects.csv'}: ${projectsRaw.length} rows`);
  console.log(`  ${path.basename(TASK_EXPORT_FILE)}: ${historicalTasksRaw.length} historical rows`);
  console.log(`  bonsai-tasks.json: ${tasksRaw.length} rows`);
  console.log(`  bonsai-projects.json: ${projectBinding.snapshotProjects} rows`);
  console.log(`  ${inputInventory.find(file => file.kind === 'invoices.csv')?.filename || 'invoices.csv'}: ${invoicesRaw.length} rows`);
  console.log(`  ${inputInventory.find(file => file.kind === 'time-entries.csv')?.filename || 'time-entries.csv'}: ${timeEntriesRaw.length} rows`);
  console.log(`  ${inputInventory.find(file => file.kind === 'expenses.csv')?.filename || 'expenses.csv'}: ${expensesRaw.length} rows`);
  console.log(`  ${inputInventory.find(file => file.kind === 'addresses.csv')?.filename || 'addresses.csv'}: ${addressesRaw.length} rows`);

  const requiredHeaders = {
    'projects.csv': ['project_id', 'status', 'title', 'client_or_company_name'],
    'invoices.csv': ['status', 'total_amount', 'currency', 'invoice_number', 'client_or_company_name'],
    'time-entries.csv': ['date', 'hours', 'member', 'project', 'client'],
    'expenses.csv': ['date', 'name', 'currency', 'amount_after_tax', 'project', 'member', 'client'],
    'addresses.csv': ['Client'],
  };
  const connectionHeaders = usesConnectionExport ? ['Name', 'Email', 'Domain'] : ['Client'];
  const missingConnectionHeaders = missingRequiredCsvHeaders(connectionInventory?.headers, connectionHeaders);
  if (missingConnectionHeaders.length > 0) {
    stats.errors.push(`${connectionInventory?.filename || 'clients.csv'}: missing required CSV columns (${missingConnectionHeaders.join(', ')})`);
  }
  const taskHistoryInventory = inputInventory.find(file => file.kind === 'task-history');
  const missingTaskHistoryHeaders = missingRequiredCsvHeaders(taskHistoryInventory?.headers, [
    'Task Name', 'Project', 'Company', 'Assignee', 'Status', 'Task ID', 'Created', 'Task Type', 'Parent Task ID',
  ]);
  if (missingTaskHistoryHeaders.length > 0) {
    stats.errors.push(`${taskHistoryInventory?.filename || 'tasks.csv'}: missing required CSV columns (${missingTaskHistoryHeaders.join(', ')})`);
  }
  const historicalTaskSourceFingerprint = taskHistoryInventory?.sha256 || null;

  async function registerOperatingSource(entityType, sourceId, destinationId, sourceFingerprint) {
    const where = {
      organizationId_sourceSystem_entityType_sourceId: {
        organizationId: ORGANIZATION_ID, sourceSystem: 'BONSAI', entityType, sourceId: String(sourceId),
      },
    };
    const existingRecord = await prisma.operatingSourceRecord.findUnique({ where });
    const assessment = assessBonsaiOperatingSourceRecord({
      organizationId: ORGANIZATION_ID, entityType, sourceId: String(sourceId),
      destinationId, sourceFingerprint, existingRecord,
    });
    if (!assessment.ready) {
      stats.operatingSourceRecords.conflicts++;
      stats.errors.push(`${entityType} ${sourceId}: operating source registry conflict (${assessment.findings.join(', ')})`);
      return;
    }
    if (assessment.operation === 'REUSE') {
      stats.operatingSourceRecords.existing++;
      return;
    }
    if (!DRY_RUN) {
      await prisma.operatingSourceRecord.create({ data: { ...assessment.record, importedAt: new Date() } });
    }
    stats.operatingSourceRecords.created++;
  }
  for (const [filename, expected] of Object.entries(requiredHeaders)) {
    const inventory = inputInventory.find(file => file.kind === filename || file.filename === filename);
    const missing = missingRequiredCsvHeaders(inventory?.headers, expected);
    if (missing.length > 0) {
      stats.errors.push(`${filename}: missing required CSV columns (${missing.join(', ')})`);
    }
  }

  // Build address lookup: Client name → address data
  const addressMap = new Map();
  for (const addr of addressesRaw) {
    const clientName = addr['Client']?.trim();
    if (!clientName) continue;
    const key = clientName.toLowerCase();
    if (addressMap.has(key) && JSON.stringify(addressMap.get(key)) !== JSON.stringify(addr)) {
      stats.errors.push(`Address "${clientName}": duplicate source rows differ; manual reconciliation required`);
      continue;
    }
    addressMap.set(key, addr);
  }

  // ============================================================
  // STEP 1: CLIENTS
  // ============================================================
  console.log('\n👥 Importing Clients...');

  // Merge operational client evidence from the legacy client export or the
  // modern mixed Connections export plus unique names from invoices/projects.
  const clientDataMap = new Map(); // normalized name → best data

  if (usesConnectionExport) {
    const connectionMapping = mapBonsaiConnections({
      connectionRows: clientsRaw,
      projectRows: projectsRaw,
      invoiceRows: invoicesRaw,
      shouldSkipClient,
    });
    stats.connectionMapping = connectionMapping.summary;
    for (const finding of connectionMapping.findings) {
      stats.errors.push(`Connections export: ${finding.code} (${finding.clientName || `row ${finding.sourceRow}`})`);
    }
    for (const mapped of connectionMapping.clients) {
      const primary = mapped.primaryConnection;
      clientDataMap.set(mapped.name.toLowerCase(), {
        name: mapped.name,
        contactName: primary?.name || '',
        contactEmail: primary?.email || '',
        phone: primary?.phone || '',
        website: mapped.domain || '',
        tags: '',
        contacts: mapped.connections.map(connection => ({
          name: connection.name || mapped.name,
          email: connection.email,
        })),
      });
    }
  } else {
    for (const row of clientsRaw) {
      const name = (row['Client'] || '').trim();
      if (shouldSkipClient(name)) { stats.clients.skipped++; continue; }
      const key = name.toLowerCase();
      const sourceClient = {
        name,
        contactName: (row['Contact Name'] || '').trim(),
        contactEmail: (row['Contact Email'] || '').trim().toLowerCase(),
        phone: (row['Phone Number'] || '').trim(),
        website: (row['Website'] || '').trim(),
        tags: (row['Tags'] || '').trim(),
        contacts: (row['Contact Email'] || '').trim() ? [{
          name: (row['Contact Name'] || '').trim() || name,
          email: (row['Contact Email'] || '').trim().toLowerCase(),
        }] : [],
      };
      if (clientDataMap.has(key) && JSON.stringify(clientDataMap.get(key)) !== JSON.stringify(sourceClient)) {
        stats.errors.push(`Client "${name}": duplicate source rows differ; manual reconciliation required`);
        continue;
      }
      clientDataMap.set(key, sourceClient);
    }
  }

  // From invoices (may add clients not in clients.csv)
  for (const inv of invoicesRaw) {
    const name = (inv.client_or_company_name || '').trim();
    if (shouldSkipClient(name)) continue;
    const key = name.toLowerCase();
    if (!clientDataMap.has(key)) {
      clientDataMap.set(key, {
        name,
        contactName: name,
        contactEmail: (inv.client_email || '').trim().toLowerCase(),
        phone: '',
        website: '',
        tags: '',
        contacts: (inv.client_email || '').trim() ? [{ name, email: inv.client_email.trim().toLowerCase() }] : [],
      });
    } else if (inv.client_email) {
      const invoiceEmail = inv.client_email.trim().toLowerCase();
      const knownEmail = clientDataMap.get(key).contactEmail;
      if (knownEmail && knownEmail !== invoiceEmail) {
        stats.errors.push(`Client "${name}": duplicate source rows differ in contact email; manual reconciliation required`);
      } else if (!knownEmail) {
        clientDataMap.get(key).contactEmail = invoiceEmail;
      }
      if (!clientDataMap.get(key).contacts.some(contact => contact.email === invoiceEmail)) {
        clientDataMap.get(key).contacts.push({ name, email: invoiceEmail });
      }
    }
  }

  // From projects (may add clients not elsewhere)
  for (const proj of projectsRaw) {
    const name = (proj.client_or_company_name || '').trim();
    if (shouldSkipClient(name)) continue;
    const key = name.toLowerCase();
    if (!clientDataMap.has(key)) {
      clientDataMap.set(key, {
        name,
        contactName: name,
        contactEmail: '',
        phone: '',
        website: '',
        tags: '',
        contacts: [],
      });
    }
  }

  // Dedup: also check by email across clients
  const emailToClientKey = new Map(); // email → clientDataMap key  
  for (const [key, data] of clientDataMap) {
    for (const contact of data.contacts) {
      if (!contact.email) continue;
      const priorClientKey = emailToClientKey.get(contact.email);
      if (priorClientKey && priorClientKey !== key) {
        stats.errors.push(`Client "${data.name}": contact email matches another Bonsai client; manual reconciliation required`);
      } else {
        emailToClientKey.set(contact.email, key);
      }
    }
  }

  // Now upsert clients into DB
  const clientIdMap = new Map(); // normalized name → DB id
  const emailToClientId = new Map(); // email → DB client id

  // Every imported invoice needs an accountable agency user. Never create a
  // synthetic login from an external CSV; unknown historical owners are
  // attributed to this importer and included in reconciliation.
  let adminUser = await prisma.user.findFirst({ where: { organizationId: ORGANIZATION_ID, role: 'ADMIN' } });
  if (!adminUser) {
    adminUser = await prisma.user.findFirst({ where: { organizationId: ORGANIZATION_ID } });
  }
  if (!adminUser) {
    console.log('  ❌ No users found in DB. Cannot create invoices without createdById.');
    process.exit(1);
  }
  console.log(`  Using admin user: ${adminUser.name} (${adminUser.id})`);

  for (const [key, data] of clientDataMap) {
    try {
      // Try to find by email first, then by name
      let existing = null;
      const emailMatches = [];
      for (const sourceContact of data.contacts) {
        const contact = await prisma.contact.findFirst({
          where: { email: sourceContact.email, client: { organizationId: ORGANIZATION_ID } },
          include: { client: true },
        });
        if (contact && !emailMatches.some(client => client.id === contact.client.id)) emailMatches.push(contact.client);
      }
      if (emailMatches.length > 1) {
        stats.errors.push(`Client "${data.name}": source contacts resolve to multiple Hub clients; manual reconciliation required`);
        stats.clients.skipped++;
        continue;
      }
      if (emailMatches.length === 1) existing = emailMatches[0];
      if (!existing) {
        existing = await prisma.client.findFirst({
          where: { organizationId: ORGANIZATION_ID, name: { equals: data.name, mode: 'insensitive' } },
        });
      }

      // Address
      const addr = addressMap.get(key);

      const clientData = {
        name: data.name,
        contactPerson: data.contactName || null,
        phone: data.phone || null,
        domain: data.website || null,
        country: addr?.Country || null,
        address: addr ? [addr['Address 1'], addr['Address 2']].filter(Boolean).join(', ') : null,
        city: addr?.City || null,
        provinceState: addr?.Region || null,
        postalCode: addr ? addr['Postal Code'] : null,
      };

      if (existing) {
        const differences = sourceDifferences(clientData, existing, [
          'name', 'contactPerson', 'phone', 'domain', 'country', 'address', 'city', 'provinceState', 'postalCode',
        ]);
        if (differences.length > 0) {
          stats.errors.push(`Client "${data.name}": Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        clientIdMap.set(key, existing.id);
        for (const contact of data.contacts) emailToClientId.set(contact.email, existing.id);
        stats.clients.existing++;
      } else {
        if (clientData.domain) {
          const domainConflict = await prisma.client.findFirst({
            where: { organizationId: ORGANIZATION_ID, domain: clientData.domain },
          });
          if (domainConflict) {
            stats.errors.push(`Client "${data.name}": Existing Hub record differs by matching domain; manual reconciliation required`);
            stats.clients.skipped++;
            continue;
          }
        }
        if (!DRY_RUN) {
          const created = await prisma.client.create({ data: { ...clientData, organizationId: ORGANIZATION_ID } });
          clientIdMap.set(key, created.id);
          for (const contact of data.contacts) emailToClientId.set(contact.email, created.id);
        }
        stats.clients.created++;
        if (DRY_RUN) {
          const dryClientId = `dry-client-${key}`;
          clientIdMap.set(key, dryClientId);
          for (const contact of data.contacts) emailToClientId.set(contact.email, dryClientId);
          console.log(`  [would create] ${data.name}`);
        }
      }

      // Create or reconcile every mapped contact. A primary is selected only
      // when the source mapper resolved one without ambiguity.
      const clientId = clientIdMap.get(key);
      for (const sourceContact of data.contacts) {
        if (!sourceContact.email || !clientId) continue;
        const existingContact = await prisma.contact.findFirst({
          where: { email: sourceContact.email, clientId },
        });
        if (!existingContact) {
          if (!DRY_RUN) {
            await prisma.contact.create({
              data: {
                email: sourceContact.email,
                name: sourceContact.name || data.name,
                clientId,
                isPrimary: sourceContact.email === data.contactEmail,
              },
            });
          }
          stats.contacts.created++;
        } else {
          const contactDifferences = sourceDifferences({
            name: sourceContact.name || data.name,
            isPrimary: sourceContact.email === data.contactEmail,
          }, existingContact, ['name', 'isPrimary']);
          if (contactDifferences.length > 0) {
            stats.errors.push(`Contact for "${data.name}": Existing Hub record differs in ${contactDifferences.join(', ')}; manual reconciliation required`);
          }
          stats.contacts.existing++;
        }
      }
    } catch (err) {
      stats.errors.push(`Client "${data.name}": ${err.message}`);
    }
  }

  console.log(`  ✅ Clients: ${stats.clients.created} created, ${stats.clients.existing} matched, ${stats.clients.skipped} skipped`);
  console.log(`  ✅ Contacts: ${stats.contacts.created} created, ${stats.contacts.existing} existing`);

  // Helper: resolve client ID from name or email
  function resolveClientId(name, email) {
    const nameKey = (name || '').trim().toLowerCase();
    const emailKey = (email || '').trim().toLowerCase();
    return clientIdMap.get(nameKey) || emailToClientId.get(emailKey) || null;
  }

  // ============================================================
  // STEP 2: PROJECTS
  // ============================================================
  console.log('\n📁 Importing Projects...');

  const projectIdMap = new Map(); // bonsaiProjectId → DB id
  const projectLookup = new Map(); // "clientName|projectTitle" → Set<DB id>
  const seenProjectSourceKeys = new Set();

  function registerProjectLookup(clientName, title, projectId) {
    const key = `${clientName.toLowerCase()}|${title.toLowerCase()}`;
    projectLookup.set(key, new Set([...(projectLookup.get(key) ?? []), projectId]));
  }

  for (const proj of projectsRaw) {
    const clientName = (proj.client_or_company_name || '').trim();
    const title = (proj.title || '').trim();
    const bonsaiId = (proj.project_id || '').trim();

    if (!title || shouldSkipClient(clientName)) {
      stats.projects.skipped++;
      continue;
    }
    if (!bonsaiId) {
      stats.projects.skipped++;
      stats.errors.push(`Project "${title}": missing immutable Bonsai project ID`);
      continue;
    }
    const projectSourceKey = bonsaiId;
    if (seenProjectSourceKeys.has(projectSourceKey)) {
      stats.projects.skipped++;
      stats.errors.push(`Project "${title}": duplicate Bonsai source identity`);
      continue;
    }
    seenProjectSourceKeys.add(projectSourceKey);

    const clientId = resolveClientId(clientName);
    if (!clientId) {
      stats.projects.skipped++;
      stats.errors.push(`Project "${title}": no client match for "${clientName}"`);
      continue;
    }

    try {
      // Dedup by bonsaiProjectId or name+client
      let existing = null;
      if (bonsaiId) {
        existing = await prisma.project.findFirst({ where: { organizationId: ORGANIZATION_ID, bonsaiProjectId: bonsaiId } });
      }
      if (!existing) {
        existing = await prisma.project.findFirst({
          where: { organizationId: ORGANIZATION_ID, name: { equals: title, mode: 'insensitive' }, clientId },
        });
      }

      const status = mapProjectStatus(proj.status);
      if (!status) {
        stats.errors.push(`Project "${title}": unsupported or missing Bonsai status`);
        stats.projects.skipped++;
        continue;
      }
      const budgetRaw = String(proj.project_budget_amount ?? '').trim();
      const budget = budgetRaw ? parseBonsaiMoney(budgetRaw) : null;
      if (budgetRaw && budget === null) {
        stats.errors.push(`Project "${title}": project budget is malformed`);
        stats.projects.skipped++;
        continue;
      }
      const startDate = parseDate(proj.start_date);
      const endDate = parseDate(proj.finish_date);

      const projectData = {
        name: title,
        clientId,
        status,
        bonsaiProjectId: bonsaiId,
        budget,
        startDate,
        endDate,
        completedAt: proj.status === 'completed' ? endDate : null,
      };
      let destinationId;

      if (existing) {
        const differences = sourceDifferences(projectData, existing, [
          'name', 'clientId', 'status', 'bonsaiProjectId', 'budget', 'startDate', 'endDate', 'completedAt',
        ]);
        if (differences.length > 0) {
          stats.errors.push(`Project "${title}": Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        projectIdMap.set(bonsaiId, existing.id);
        registerProjectLookup(clientName, title, existing.id);
        destinationId = existing.id;
        stats.projects.existing++;
      } else {
        if (!DRY_RUN) {
          const created = await prisma.project.create({ data: { ...projectData, organizationId: ORGANIZATION_ID } });
          projectIdMap.set(bonsaiId, created.id);
          registerProjectLookup(clientName, title, created.id);
          destinationId = created.id;
        }
        stats.projects.created++;
        if (DRY_RUN) {
          const dryProjectId = `dry-project-${bonsaiId}`;
          projectIdMap.set(bonsaiId, dryProjectId);
          registerProjectLookup(clientName, title, dryProjectId);
          destinationId = dryProjectId;
        }
        if (DRY_RUN) console.log(`  [would create] ${title} → ${clientName} (${status})`);
      }
      await registerOperatingSource('PROJECT', bonsaiId, destinationId, projectSnapshotSha256);
    } catch (err) {
      stats.errors.push(`Project "${title}": ${err.message}`);
    }
  }

  for (const [key, matches] of projectLookup) {
    if (matches.size > 1) {
      stats.errors.push(`Project lookup "${key}": multiple exact Bonsai projects require consolidation before name-based records can be imported`);
    }
  }

  console.log(`  ✅ Projects: ${stats.projects.created} created, ${stats.projects.existing} matched, ${stats.projects.skipped} skipped`);

  // Helper: resolve project ID
  function resolveProjectId(clientName, projectTitle) {
    const key = `${(clientName || '').trim().toLowerCase()}|${(projectTitle || '').trim().toLowerCase()}`;
    const matches = [...(projectLookup.get(key) ?? [])];
    return matches.length === 1 ? matches[0] : null;
  }

  // Resolve historical owners only within this organization. External sources
  // never create login-capable accounts; unknown owners remain unresolved for
  // tasks and are attributed to the importer only for historical time rows.
  const userRecordCache = new Map();
  const organizationUsers = await prisma.user.findMany({ where: { organizationId: ORGANIZATION_ID } });

  async function findUser(ownerName) {
    const key = (ownerName || '').trim().toLowerCase();
    if (!key) return null;
    if (userRecordCache.has(key)) return userRecordCache.get(key);
    const exact = organizationUsers.filter(user => (user.name || '').trim().toLowerCase() === key);
    const firstName = key.includes('cameron') ? 'cameron'
      : key.includes('bianca') ? 'bianca' : key.split(/\s+/)[0];
    const candidates = exact.length > 0 ? exact : organizationUsers.filter(
      user => (user.name || '').trim().toLowerCase().split(/\s+/).includes(firstName),
    );
    const user = candidates.length === 1 ? candidates[0] : null;
    userRecordCache.set(key, user || null);
    return user || null;
  }

  // ============================================================
  // STEP 3: TASKS
  // ============================================================
  console.log('\n✅ Importing Tasks...');
  const existingTasks = await prisma.task.findMany({
    where: { project: { organizationId: ORGANIZATION_ID }, deletedAt: null },
  });
  const tasksByBonsaiId = new Map();
  for (const task of existingTasks) {
    const sourceId = String(parseTaskProperties(task.properties).bonsaiTaskId || '').trim();
    if (!sourceId) continue;
    if (tasksByBonsaiId.has(sourceId)) {
      stats.errors.push(`Task ${sourceId}: duplicate Hub Bonsai task identity`);
      continue;
    }
    tasksByBonsaiId.set(sourceId, task);
  }
  const seenTaskIds = new Set();
  for (const task of tasksRaw) {
    const sourceId = String(task.uuid || '').trim();
    const title = String(task.title || '').trim();
    const projectSourceId = String(task.project_id || '').trim();
    if (!sourceId || !title) {
      stats.tasks.skipped++;
      stats.errors.push(`Task "${title}": missing source UUID or title`);
      continue;
    }
    if (seenTaskIds.has(sourceId)) {
      stats.tasks.skipped++;
      stats.errors.push(`Task ${sourceId}: duplicate Bonsai source identity`);
      continue;
    }
    seenTaskIds.add(sourceId);
    const projectId = projectIdMap.get(projectSourceId);
    if (!projectSourceId || !projectId) {
      stats.tasks.skipped++;
      stats.errors.push(`Task "${title}": no exact Bonsai project ID match (${projectSourceId || 'projectless'})`);
      continue;
    }
    if (task.archived_at) {
      stats.tasks.skipped++;
      stats.errors.push(`Task "${title}": archived source task requires an explicit retention decision`);
      continue;
    }
    const status = mapTaskStatus(task);
    const priority = mapTaskPriority(task.priority);
    const startDate = task.start_date ? parseDate(task.start_date) : null;
    const dueDate = task.due_date ? parseDate(task.due_date) : null;
    const completedAt = task.completed_at ? parseDate(task.completed_at) : null;
    if (!status || !priority || (task.start_date && !startDate) || (task.due_date && !dueDate)
      || (task.completed_at && !completedAt)) {
      stats.tasks.skipped++;
      stats.errors.push(`Task "${title}": unsupported status, priority, or date evidence`);
      continue;
    }
    const ownerName = String(task.assignee_member_name || '').trim();
    const owner = ownerName ? await findUser(ownerName) : null;
    if (ownerName && !owner) {
      stats.tasks.skipped++;
      stats.errors.push(`Task "${title}": no exact organization owner match for "${ownerName}"`);
      continue;
    }
    const taskData = {
      title,
      description: String(task.description_plain_text || '').trim() || null,
      status,
      priority,
      projectId,
      assigneeId: owner?.id || null,
      startDate,
      dueDate,
      completedAt,
      properties: JSON.stringify({ bonsaiTaskId: sourceId }),
    };
    const existing = tasksByBonsaiId.get(sourceId);
    if (existing) {
      const differences = sourceDifferences(taskData, existing, [
        'title', 'description', 'status', 'priority', 'projectId', 'assigneeId',
        'startDate', 'dueDate', 'completedAt',
      ]);
      if (differences.length > 0) {
        stats.errors.push(`Task "${title}": Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
      }
      await registerOperatingSource('TASK', sourceId, existing.id, taskSnapshotSha256);
      stats.tasks.existing++;
      continue;
    }
    let taskDestinationId = `dry-task-${sourceId}`;
    if (!DRY_RUN) {
      const created = await prisma.task.create({ data: taskData });
      taskDestinationId = created.id;
    }
    await registerOperatingSource('TASK', sourceId, taskDestinationId, taskSnapshotSha256);
    stats.tasks.created++;
    if (DRY_RUN && stats.tasks.created <= 10) console.log(`  [would create] ${title}`);
  }
  console.log(`  ✅ Tasks: ${stats.tasks.created} created, ${stats.tasks.existing} existing, ${stats.tasks.skipped} skipped`);

  // The native task export is a separate historical source. Its task_… IDs do
  // not equal API UUIDs, so it is never merged into the current snapshot by
  // guesswork. Exact displayed overlaps and projectless rows remain findings.
  console.log('\n🗂️ Importing Historical Tasks...');
  const historicalMapping = mapBonsaiHistoricalTasks({
    taskRows: historicalTasksRaw,
    projectRows: projectsRaw,
    currentTasks: tasksRaw,
    shouldSkipClient,
  });
  stats.historicalTaskMapping = historicalMapping.summary;
  stats.historicalTasks.skipped += historicalTasksRaw.length - historicalMapping.tasks.length;
  for (const finding of historicalMapping.findings) {
    stats.errors.push(`Historical task row ${finding.sourceRow || 'unknown'}: ${finding.code}`);
  }

  const historicalTasksById = new Map();
  for (const task of existingTasks) {
    const sourceId = String(parseTaskProperties(task.properties).bonsaiLegacyTaskId || '').trim();
    if (!sourceId) continue;
    if (historicalTasksById.has(sourceId)) {
      stats.errors.push(`Historical task ${sourceId}: duplicate Hub Bonsai task identity`);
      continue;
    }
    historicalTasksById.set(sourceId, task);
  }
  const historicalTaskIdMap = new Map();
  const historicalTaskRecords = new Map();
  for (const source of historicalMapping.tasks) {
    const projectId = projectIdMap.get(source.projectSourceId);
    if (!projectId) {
      stats.historicalTasks.skipped++;
      stats.errors.push(`Historical task ${source.sourceId}: no exact Bonsai project ID match`);
      continue;
    }
    const owner = source.ownerName ? await findUser(source.ownerName) : null;
    if (source.ownerName && !owner) {
      stats.historicalTasks.skipped++;
      stats.errors.push(`Historical task ${source.sourceId}: no exact organization owner match`);
      continue;
    }
    const properties = JSON.stringify({
      bonsaiLegacyTaskId: source.sourceId,
      bonsaiSource: 'native-task-export',
      ...source.evidence,
    });
    const taskData = {
      title: source.title,
      status: source.status,
      priority: source.priority,
      projectId,
      assigneeId: owner?.id || null,
      startDate: source.startDate ? new Date(source.startDate) : null,
      dueDate: source.dueDate ? new Date(source.dueDate) : null,
      estimatedTime: source.evidence.estimate,
      properties,
      ...(source.createdAt ? { createdAt: new Date(source.createdAt) } : {}),
    };
    const existing = historicalTasksById.get(source.sourceId);
    if (existing) {
      const differences = sourceDifferences(taskData, existing, [
        'title', 'status', 'priority', 'projectId', 'assigneeId', 'startDate', 'dueDate',
        'estimatedTime', 'properties', 'createdAt',
      ]);
      if (differences.length > 0) {
        stats.errors.push(`Historical task ${source.sourceId}: Existing Hub record differs in ${differences.join(', ')}`);
      }
      historicalTaskIdMap.set(source.sourceId, existing.id);
      historicalTaskRecords.set(source.sourceId, existing);
      await registerOperatingSource('TASK', source.sourceId, existing.id, historicalTaskSourceFingerprint);
      stats.historicalTasks.existing++;
      continue;
    }
    if (!DRY_RUN) {
      const created = await prisma.task.create({ data: taskData });
      historicalTaskIdMap.set(source.sourceId, created.id);
    } else {
      historicalTaskIdMap.set(source.sourceId, `dry-historical-task-${source.sourceId}`);
    }
    await registerOperatingSource('TASK', source.sourceId, historicalTaskIdMap.get(source.sourceId), historicalTaskSourceFingerprint);
    stats.historicalTasks.created++;
  }

  // Link hierarchy only after every historical task has a stable destination
  // identity. The surrounding confirmed import transaction makes this atomic.
  for (const source of historicalMapping.tasks.filter(task => task.parentSourceId)) {
    const taskId = historicalTaskIdMap.get(source.sourceId);
    const parentId = historicalTaskIdMap.get(source.parentSourceId);
    if (!taskId || !parentId) {
      stats.errors.push(`Historical task ${source.sourceId}: parent destination is unavailable`);
      continue;
    }
    const existing = historicalTaskRecords.get(source.sourceId);
    if (existing && existing.parentId !== parentId) {
      stats.errors.push(`Historical task ${source.sourceId}: Existing Hub parent differs from source evidence`);
      continue;
    }
    if (!DRY_RUN && !existing) await prisma.task.update({ where: { id: taskId }, data: { parentId } });
    stats.historicalTasks.parentsLinked++;
  }
  console.log(`  ✅ Historical tasks: ${stats.historicalTasks.created} created, ${stats.historicalTasks.existing} existing, ${stats.historicalTasks.skipped} blocked`);

  // ============================================================
  // STEP 4: INVOICES
  // ============================================================
  console.log('\n💰 Importing Invoices...');
  const seenInvoiceNumbers = new Set();

  for (const inv of invoicesRaw) {
    const invoiceNumber = (inv.invoice_number || '').trim();
    const clientName = (inv.client_or_company_name || '').trim();
    const clientEmail = (inv.client_email || '').trim();

    if (!invoiceNumber || shouldSkipClient(clientName)) {
      stats.invoices.skipped++;
      continue;
    }
    if (seenInvoiceNumbers.has(invoiceNumber.toLowerCase())) {
      stats.invoices.skipped++;
      stats.errors.push(`Invoice #${invoiceNumber}: duplicate Bonsai source identity`);
      continue;
    }
    seenInvoiceNumbers.add(invoiceNumber.toLowerCase());

    const clientId = resolveClientId(clientName, clientEmail);
    if (!clientId) {
      stats.invoices.skipped++;
      stats.errors.push(`Invoice #${invoiceNumber}: no client match for "${clientName}"`);
      continue;
    }

    try {
      const status = mapInvoiceStatus(inv.status);
      const totalAmount = parseBonsaiMoney(inv.total_amount);
      const taxRaw = String(inv.calculated_tax_amount ?? '').trim();
      const taxRateRaw = String(inv.calculated_tax_percent ?? '').trim();
      const tax = taxRaw ? parseBonsaiMoney(taxRaw) : 0;
      const taxRate = taxRateRaw ? parseBonsaiDecimal(taxRateRaw) : 0;
      const currency = (inv.currency || '').toUpperCase();
      const issueDate = parseDate(inv.issued_date);
      const paidDate = parseDate(inv.paid_date);
      if (totalAmount === null || tax === null || taxRate === null) {
        stats.errors.push(`Invoice #${invoiceNumber}: invoice totals are malformed`);
        stats.invoices.skipped++;
        continue;
      }
      if (!status || !['CAD', 'USD'].includes(currency) || !issueDate || totalAmount < 0 || tax < 0 || tax > totalAmount
        || (status === 'PAID' && !paidDate)) {
        stats.errors.push(`Invoice #${invoiceNumber}: incomplete or unsupported status, currency, date, or totals`);
        stats.invoices.skipped++;
        continue;
      }
      // Dedup by invoiceNumber
      const existing = await prisma.invoice.findFirst({
        where: { invoiceNumber, client: { organizationId: ORGANIZATION_ID } },
      });

      if (existing) {
        const differences = sourceDifferences({
          clientId, status, currency, total: totalAmount,
        }, existing, ['clientId', 'status', 'currency', 'total']);
        if (differences.length > 0) {
          stats.errors.push(`Invoice #${invoiceNumber}: Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        stats.invoices.existing++;
        continue;
      }

      const subtotal = totalAmount - tax;
      const dueDate = parseDate(inv.due_date);
      const paymentMethod = mapPaymentMethod(inv.payment_method);
      const bonsaiInvoiceId = extractBonsaiId(inv.contractor_invoice_link) || invoiceNumber;
      const projectName = (inv.contractor_project_name || '').trim();

      // Find matching project
      const projectId = resolveProjectId(clientName, projectName);

      const invoiceData = {
        invoiceNumber,
        bonsaiInvoiceId,
        status,
        title: projectName || `Invoice #${invoiceNumber}`,
        currency,
        subtotal: Math.max(subtotal, 0),
        tax,
        taxRate,
        total: totalAmount,
        issueDate,
        dueDate,
        paidAt: status === 'PAID' ? paidDate : null,
        paymentMethod,
        clientId,
        projectId: projectId || undefined,
        createdById: adminUser.id,
        amountUsd: currency === 'USD' ? totalAmount : null,
        amountCad: currency === 'CAD' ? totalAmount : null,
      };

      if (!DRY_RUN) {
        const created = await prisma.invoice.create({ data: invoiceData });

        // Create single line item
        if (totalAmount > 0) {
          await prisma.invoiceLineItem.create({
            data: {
              description: projectName || `Services - Invoice #${invoiceNumber}`,
              quantity: 1,
              unitPrice: subtotal,
              total: subtotal,
              invoiceId: created.id,
            },
          });
        }
      }
      if (totalAmount > 0) stats.lineItems.created++;

      stats.invoices.created++;
      if (DRY_RUN && stats.invoices.created <= 10) {
        console.log(`  [would create] #${invoiceNumber} ${clientName} $${totalAmount} ${currency} (${status})`);
      }
    } catch (err) {
      stats.errors.push(`Invoice #${invoiceNumber}: ${err.message}`);
    }
  }

  if (DRY_RUN && stats.invoices.created > 10) {
    console.log(`  ... and ${stats.invoices.created - 10} more`);
  }
  console.log(`  ✅ Invoices: ${stats.invoices.created} created, ${stats.invoices.existing} existing, ${stats.invoices.skipped} skipped`);
  console.log(`  ✅ Line Items: ${stats.lineItems.created} created`);

  // ============================================================
  // STEP 5: TIME ENTRIES
  // ============================================================
  console.log('\n⏱️  Importing Time Entries...');

  // Resolve historical owners only within this organization. External exports
  // must not create login-capable accounts; unmatched owners remain attributed
  // to the importer and are visible in the reconciliation summary.
  const seenTimeEntryKeys = new Set();

  async function resolveUserId(ownerName) {
    const ownerKey = (ownerName || '').trim();
    const user = await findUser(ownerName);

    if (!user && ownerKey) {
      stats.owners.mappedToImporter++;
      console.log(`  [owner mapped to importer] ${ownerName}`);
    }
    const id = user?.id || adminUser.id;
    return id;
  }

  for (const entry of timeEntriesRaw) {
    const clientName = (entry.client_name || '').trim();
    const projectTitle = (entry.project_title || '').trim();
    const ownerName = (entry.owner_name || '').trim();
    const dateStr = (entry.date || '').trim();
    const formattedTime = (entry.formatted_time || '').trim();

    if (!projectTitle || !dateStr || shouldSkipClient(clientName)) {
      stats.timeEntries.skipped++;
      continue;
    }

    const resolvedProjectId = resolveProjectId(clientName, projectTitle);
    if (!resolvedProjectId) {
      stats.timeEntries.skipped++;
      stats.errors.push(`TimeEntry: no exact client/project match for "${projectTitle}" / "${clientName}"`);
      continue;
    }

    try {
      const duration = parseFormattedTime(formattedTime);
      if (duration === 0) { stats.timeEntries.skipped++; continue; }

      const date = parseDate(dateStr);
      if (!date) { stats.timeEntries.skipped++; continue; }

      const userId = await resolveUserId(ownerName);
      const rateRaw = String(entry.rate ?? '').trim();
      const rate = rateRaw ? parseBonsaiMoney(rateRaw) : null;
      if (rateRaw && rate === null) {
        stats.timeEntries.skipped++;
        stats.errors.push(`TimeEntry "${projectTitle}" ${dateStr}: time-entry rate is malformed`);
        continue;
      }
      const billable = (entry.billing_status || '').toLowerCase() === 'billed';
      const notes = (entry.notes || '').trim();
      const timeEntrySourceKey = [resolvedProjectId, userId, date.toISOString(), duration].join('|');
      if (seenTimeEntryKeys.has(timeEntrySourceKey)) {
        stats.timeEntries.skipped++;
        stats.errors.push(`TimeEntry "${projectTitle}" ${dateStr}: duplicate Bonsai source identity`);
        continue;
      }
      seenTimeEntryKeys.add(timeEntrySourceKey);
      const timeEntryData = {
        description: notes || `${projectTitle} work`,
        duration,
        date,
        billable,
        hourlyRate: rate || null,
        projectId: resolvedProjectId,
        userId,
        source: 'BONSAI_IMPORT',
      };

      // Dedup: same project + user + date + duration
      const existing = await prisma.timeEntry.findFirst({
        where: {
          projectId: resolvedProjectId,
          userId,
          date,
          duration,
        },
      });

      if (existing) {
        const differences = sourceDifferences(timeEntryData, existing, [
          'description', 'billable', 'hourlyRate', 'source',
        ]);
        if (differences.length > 0) {
          stats.errors.push(`TimeEntry "${projectTitle}" ${dateStr}: Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        stats.timeEntries.existing++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.timeEntry.create({
          data: timeEntryData,
        });
      }

      stats.timeEntries.created++;
      if (DRY_RUN && stats.timeEntries.created <= 5) {
        console.log(`  [would create] ${ownerName} → ${projectTitle} ${formattedTime} (${billable ? 'billable' : 'unbilled'})`);
      }
    } catch (err) {
      stats.errors.push(`TimeEntry "${projectTitle}" ${dateStr}: ${err.message}`);
    }
  }

  if (DRY_RUN && stats.timeEntries.created > 5) {
    console.log(`  ... and ${stats.timeEntries.created - 5} more`);
  }
  console.log(`  ✅ Time Entries: ${stats.timeEntries.created} created, ${stats.timeEntries.existing} existing, ${stats.timeEntries.skipped} skipped`);

  // ============================================================
  // STEP 6: EXPENSES
  // ============================================================
  console.log('\n💸 Importing Expenses...');
  const seenExpenseKeys = new Set();

  // Skip personal and e-Transfer entries
  function shouldSkipExpense(row) {
    const name = (row.name || '').toLowerCase();
    const tags = (row.tags || '').toLowerCase();
    if (tags.includes('personal')) return true;
    if (name.includes('e-transfer sent cameron')) return true;
    if (name.includes('e-transfer sent cam')) return true;
    if (name.includes('personal')) return true;
    return false;
  }

  for (const exp of expensesRaw) {
    if (shouldSkipExpense(exp)) {
      stats.expenses.skipped++;
      continue;
    }

    const description = (exp.name || '').trim();
    const amount = parseBonsaiMoney(exp.amount_after_tax || exp.amount_pre_tax);
    const currency = (exp.currency || '').toUpperCase();
    const category = mapExpenseCategory(exp.tags);
    const date = parseDate(exp.date);
    const billable = (exp.billable || '').toLowerCase() === 'true';
    const clientName = (exp.client || '').trim();
    const projectName = (exp.project || '').trim();

    if (amount === null) {
      stats.expenses.skipped++;
      stats.errors.push(`Expense "${description.substring(0, 40)}": expense amount is malformed`);
      continue;
    }
    if (!description || amount === 0 || !date || !['CAD', 'USD'].includes(currency)) {
      stats.expenses.skipped++;
      if (description && amount !== 0 && date && !['CAD', 'USD'].includes(currency)) {
        stats.errors.push(`Expense "${description.substring(0, 40)}": currency is missing or unsupported`);
      }
      continue;
    }

    const clientId = clientName ? resolveClientId(clientName) : null;
    if (clientName && !clientId) {
      stats.expenses.skipped++;
      stats.errors.push(`Expense "${description.substring(0, 40)}": no client match for "${clientName}"`);
      continue;
    }
    let projectId = null;
    if (projectName) {
      if (!clientName) {
        stats.expenses.skipped++;
        stats.errors.push(`Expense "${description.substring(0, 40)}": no exact client/project match for "${projectName}"`);
        continue;
      }
      projectId = resolveProjectId(clientName, projectName);
      if (!projectId) {
        stats.expenses.skipped++;
        stats.errors.push(`Expense "${description.substring(0, 40)}": no exact client/project match for "${projectName}" / "${clientName}"`);
        continue;
      }
    }

    try {
      const expenseSourceKey = [description.toLowerCase(), date.toISOString(), amount, currency, clientId || '', projectId || ''].join('|');
      if (seenExpenseKeys.has(expenseSourceKey)) {
        stats.expenses.skipped++;
        stats.errors.push(`Expense "${description.substring(0, 40)}": duplicate Bonsai source identity`);
        continue;
      }
      seenExpenseKeys.add(expenseSourceKey);
      const expenseData = {
        description,
        amount,
        currency,
        category,
        date,
        billable,
        clientId: clientId || null,
        projectId: projectId || null,
      };
      // Dedup by the complete source identity, not a partial financial match.
      const existing = await prisma.expense.findFirst({
        where: {
          organizationId: ORGANIZATION_ID,
          description,
          date,
          amount,
          currency,
          clientId: clientId || null,
          projectId: projectId || null,
        },
      });

      if (existing) {
        const differences = sourceDifferences(expenseData, existing, ['category', 'billable']);
        if (differences.length > 0) {
          stats.errors.push(`Expense "${description.substring(0, 40)}": Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        stats.expenses.skipped++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.expense.create({
          data: {
            organizationId: ORGANIZATION_ID,
            ...expenseData,
          },
        });
      }

      stats.expenses.created++;
      if (DRY_RUN && stats.expenses.created <= 5) {
        console.log(`  [would create] ${description.substring(0, 60)} $${amount} ${currency} (${category})`);
      }
    } catch (err) {
      stats.errors.push(`Expense "${description.substring(0, 40)}": ${err.message}`);
    }
  }

  if (DRY_RUN && stats.expenses.created > 5) {
    console.log(`  ... and ${stats.expenses.created - 5} more`);
  }
  console.log(`  ✅ Expenses: ${stats.expenses.created} created, ${stats.expenses.skipped} skipped`);

  if (!DRY_RUN && stats.errors.length > 0) {
    throw new Error('Live import cannot complete with unresolved reconciliation findings');
  }
  if (!DRY_RUN && !inputInventory.every(file => file.present)) {
    throw new Error('Live import cannot complete with an incomplete input inventory');
  }
  const sourceFingerprint = fingerprintInputInventory(inputInventory);
  const planFingerprint = fingerprintBonsaiPlan({ sourceFingerprint, stats });
  if (!DRY_RUN) {
    const approved = JSON.parse(fs.readFileSync(path.resolve(APPROVED_SUMMARY_FILE), 'utf8'));
    assertApprovedBonsaiDryRun(approved, {
      organizationId: ORGANIZATION_ID,
      sourceFingerprint,
      planFingerprint,
      targetFingerprint: sandboxTarget.targetFingerprint,
    });
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  IMPORT SUMMARY ${DRY_RUN ? '(DRY RUN — nothing written)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Clients:      ${stats.clients.created} new, ${stats.clients.existing} matched, ${stats.clients.skipped} skipped`);
  console.log(`  Contacts:     ${stats.contacts.created} new, ${stats.contacts.existing} existing`);
  console.log(`  Projects:     ${stats.projects.created} new, ${stats.projects.existing} matched, ${stats.projects.skipped} skipped`);
  console.log(`  Tasks:        ${stats.tasks.created} new, ${stats.tasks.existing} matched, ${stats.tasks.skipped} skipped`);
  console.log(`  Task History: ${stats.historicalTasks.created} new, ${stats.historicalTasks.existing} matched, ${stats.historicalTasks.skipped} blocked, ${stats.historicalTasks.parentsLinked} parents linked`);
  console.log(`  Source IDs:   ${stats.operatingSourceRecords.created} new, ${stats.operatingSourceRecords.existing} existing, ${stats.operatingSourceRecords.conflicts} conflicts`);
  console.log(`  Invoices:     ${stats.invoices.created} new, ${stats.invoices.existing} existing, ${stats.invoices.skipped} skipped`);
  console.log(`  Line Items:   ${stats.lineItems.created} new`);
  console.log(`  Time Entries: ${stats.timeEntries.created} new, ${stats.timeEntries.existing} existing, ${stats.timeEntries.skipped} skipped`);
  console.log(`  Expenses:     ${stats.expenses.created} new, ${stats.expenses.skipped} skipped`);

  if (stats.errors.length > 0) {
    console.log(`\n  ⚠ Errors (${stats.errors.length}):`);
    // Show first 20 errors
    for (const err of stats.errors.slice(0, 20)) {
      console.log(`    - ${err}`);
    }
    if (stats.errors.length > 20) {
      console.log(`    ... and ${stats.errors.length - 20} more`);
    }
  }

  const reconciliation = {
    generatedAt: new Date().toISOString(),
    mode: DRY_RUN ? 'dry-run' : 'live',
    sandboxTarget: {
      environmentKind: sandboxTarget.environmentKind,
      targetFingerprint: sandboxTarget.targetFingerprint,
    },
    organization: { id: organization.id, name: organization.name },
    csvDir: CSV_DIR,
    inputInventory,
    sourceFingerprint,
    planFingerprint,
    stats,
    complete: inputInventory.every(file => file.present) && stats.errors.length === 0,
  };
  console.log('');
  return reconciliation;
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    if (!summaryWritten) {
      fs.ftruncateSync(summaryDescriptor, 0);
      fs.writeFileSync(summaryDescriptor, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        mode: DRY_RUN ? 'dry-run' : 'live',
        state: 'FAILED',
        complete: false,
        reasonCode: 'IMPORT_FAILED',
      }, null, 2)}\n`, 'utf8');
    }
    process.exit(1);
  })
  .finally(async () => {
    fs.closeSync(summaryDescriptor);
    await prisma.$disconnect();
  });
