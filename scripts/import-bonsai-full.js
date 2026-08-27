#!/usr/bin/env node

/**
 * Bonsai → Agency Hub Full Import Script
 *
 * Imports: Clients, Contacts, Projects, Invoices, Time Entries, Expenses
 * from Bonsai CSV exports into the Agency Hub database.
 *
 * Usage:
 *   node scripts/import-bonsai-full.js --dry-run --organization-id <id> --csv-dir ./bonsai-export --summary-file ./reconciliation.json
 *   node scripts/import-bonsai-full.js --confirm --organization-id <id> --csv-dir ./bonsai-export --approved-summary ./reviewed-dry-run.json --summary-file ./live-reconciliation.json
 *
 * Reconciliation-first and replay-safe. Existing Hub records are matched but
 * never automatically overwritten. Natural/source identities are checked on:
 *   - Clients: by email or name
 *   - Projects: by bonsaiProjectId
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
import { assertApprovedBonsaiDryRun, fingerprintBonsaiPlan, fingerprintInputInventory, sourceDifferences } from '../src/services/bonsai-import-evidence.service.js';

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
function readCSV(filename) {
  return new Promise((resolve, reject) => {
    const results = [];
    const filePath = path.join(CSV_DIR, filename);
    if (!fs.existsSync(filePath)) {
      inputInventory.push({ filename, path: filePath, present: false, rows: 0, sha256: null });
      console.log(`  ⚠ File not found: ${filePath}`);
      resolve([]);
      return;
    }
    const sourceBytes = fs.readFileSync(filePath);
    Readable.from(sourceBytes)
      .pipe(csvParser())
      .on('data', (row) => results.push(row))
      .on('end', () => {
        const sha256 = crypto.createHash('sha256').update(sourceBytes).digest('hex');
        inputInventory.push({ filename, path: filePath, present: true, rows: results.length, sha256 });
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

function parseFloat2(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
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
  invoices: { created: 0, existing: 0, skipped: 0 },
  lineItems: { created: 0 },
  timeEntries: { created: 0, existing: 0, skipped: 0 },
  expenses: { created: 0, skipped: 0 },
  owners: { mappedToImporter: 0 },
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
  const [clientsRaw, projectsRaw, invoicesRaw, timeEntriesRaw, expensesRaw, addressesRaw] = await Promise.all([
    readCSV('clients.csv'),
    readCSV('projects.csv'),
    readCSV('invoices.csv'),
    readCSV('time-entries.csv'),
    readCSV('expenses.csv'),
    readCSV('addresses.csv'),
  ]);

  console.log(`  clients.csv: ${clientsRaw.length} rows`);
  console.log(`  projects.csv: ${projectsRaw.length} rows`);
  console.log(`  invoices.csv: ${invoicesRaw.length} rows`);
  console.log(`  time-entries.csv: ${timeEntriesRaw.length} rows`);
  console.log(`  expenses.csv: ${expensesRaw.length} rows`);
  console.log(`  addresses.csv: ${addressesRaw.length} rows`);

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

  // Merge client sources: clients.csv + unique names from invoices/projects
  const clientDataMap = new Map(); // normalized name → best data

  // From clients.csv
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
    };
    if (clientDataMap.has(key) && JSON.stringify(clientDataMap.get(key)) !== JSON.stringify(sourceClient)) {
      stats.errors.push(`Client "${name}": duplicate source rows differ; manual reconciliation required`);
      continue;
    }
    clientDataMap.set(key, sourceClient);
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
      });
    } else if (inv.client_email) {
      const invoiceEmail = inv.client_email.trim().toLowerCase();
      const knownEmail = clientDataMap.get(key).contactEmail;
      if (knownEmail && knownEmail !== invoiceEmail) {
        stats.errors.push(`Client "${name}": duplicate source rows differ in contact email; manual reconciliation required`);
      } else if (!knownEmail) {
        clientDataMap.get(key).contactEmail = invoiceEmail;
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
      });
    }
  }

  // Dedup: also check by email across clients
  const emailToClientKey = new Map(); // email → clientDataMap key  
  for (const [key, data] of clientDataMap) {
    if (data.contactEmail) {
      const priorClientKey = emailToClientKey.get(data.contactEmail);
      if (priorClientKey && priorClientKey !== key) {
        stats.errors.push(`Client "${data.name}": contact email matches another Bonsai client; manual reconciliation required`);
      } else {
        emailToClientKey.set(data.contactEmail, key);
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
      if (data.contactEmail) {
        const contact = await prisma.contact.findFirst({
          where: { email: data.contactEmail, client: { organizationId: ORGANIZATION_ID } },
          include: { client: true },
        });
        if (contact) existing = contact.client;
      }
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
        if (data.contactEmail) emailToClientId.set(data.contactEmail, existing.id);
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
          if (data.contactEmail) emailToClientId.set(data.contactEmail, created.id);
        }
        stats.clients.created++;
        if (DRY_RUN) {
          const dryClientId = `dry-client-${key}`;
          clientIdMap.set(key, dryClientId);
          if (data.contactEmail) emailToClientId.set(data.contactEmail, dryClientId);
          console.log(`  [would create] ${data.name}`);
        }
      }

      // Upsert contact
      const clientId = clientIdMap.get(key);
      if (data.contactEmail && clientId) {
        const existingContact = await prisma.contact.findFirst({
          where: { email: data.contactEmail, clientId },
        });
        if (!existingContact) {
          if (!DRY_RUN) {
            await prisma.contact.create({
              data: {
                email: data.contactEmail,
                name: data.contactName || data.name,
                clientId,
                isPrimary: true,
              },
            });
          }
          stats.contacts.created++;
        } else {
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
  const projectLookup = new Map(); // "clientName|projectTitle" → DB id
  const seenProjectSourceKeys = new Set();

  for (const proj of projectsRaw) {
    const clientName = (proj.client_or_company_name || '').trim();
    const title = (proj.title || '').trim();
    const bonsaiId = (proj.project_id || '').trim();

    if (!title || shouldSkipClient(clientName)) {
      stats.projects.skipped++;
      continue;
    }
    const projectSourceKey = bonsaiId || `${clientName.toLowerCase()}|${title.toLowerCase()}`;
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
      const budget = proj.project_budget_amount ? parseFloat2(proj.project_budget_amount) : null;
      const startDate = parseDate(proj.start_date);
      const endDate = parseDate(proj.finish_date);

      const projectData = {
        name: title,
        clientId,
        status,
        bonsaiProjectId: bonsaiId || null,
        budget,
        startDate,
        endDate,
        completedAt: proj.status === 'completed' ? endDate : null,
      };

      if (existing) {
        const differences = sourceDifferences(projectData, existing, [
          'name', 'clientId', 'status', 'bonsaiProjectId', 'budget', 'startDate', 'endDate', 'completedAt',
        ]);
        if (differences.length > 0) {
          stats.errors.push(`Project "${title}": Existing Hub record differs in ${differences.join(', ')}; manual reconciliation required`);
        }
        projectIdMap.set(bonsaiId, existing.id);
        projectLookup.set(`${clientName.toLowerCase()}|${title.toLowerCase()}`, existing.id);
        stats.projects.existing++;
      } else {
        if (!DRY_RUN) {
          const created = await prisma.project.create({ data: { ...projectData, organizationId: ORGANIZATION_ID } });
          projectIdMap.set(bonsaiId, created.id);
          projectLookup.set(`${clientName.toLowerCase()}|${title.toLowerCase()}`, created.id);
        }
        stats.projects.created++;
        if (DRY_RUN) {
          const dryProjectId = `dry-project-${bonsaiId || `${clientName}-${title}`}`;
          projectIdMap.set(bonsaiId, dryProjectId);
          projectLookup.set(`${clientName.toLowerCase()}|${title.toLowerCase()}`, dryProjectId);
        }
        if (DRY_RUN) console.log(`  [would create] ${title} → ${clientName} (${status})`);
      }
    } catch (err) {
      stats.errors.push(`Project "${title}": ${err.message}`);
    }
  }

  console.log(`  ✅ Projects: ${stats.projects.created} created, ${stats.projects.existing} matched, ${stats.projects.skipped} skipped`);

  // Helper: resolve project ID
  function resolveProjectId(clientName, projectTitle) {
    const key = `${(clientName || '').trim().toLowerCase()}|${(projectTitle || '').trim().toLowerCase()}`;
    return projectLookup.get(key) || null;
  }

  // ============================================================
  // STEP 3: INVOICES
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
      const totalAmount = parseFloat2(inv.total_amount);
      const tax = parseFloat2(inv.calculated_tax_amount);
      const taxRate = parseFloat2(inv.calculated_tax_percent);
      const currency = (inv.currency || '').toUpperCase();
      const issueDate = parseDate(inv.issued_date);
      const paidDate = parseDate(inv.paid_date);
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
  // STEP 4: TIME ENTRIES
  // ============================================================
  console.log('\n⏱️  Importing Time Entries...');

  // Resolve historical owners only within this organization. External exports
  // must not create login-capable accounts; unmatched owners remain attributed
  // to the importer and are visible in the reconciliation summary.
  const userCache = new Map(); // owner_name(lower) → userId
  const seenTimeEntryKeys = new Set();

  async function resolveUserId(ownerName) {
    const key = (ownerName || '').trim().toLowerCase();
    if (userCache.has(key)) return userCache.get(key);

    let user = null;
    if (key.includes('cameron')) {
      user = await prisma.user.findFirst({
        where: { organizationId: ORGANIZATION_ID, OR: [{ name: { contains: 'Cameron', mode: 'insensitive' } }, { email: { contains: 'cameron' } }] },
      });
    } else if (key.includes('bianca')) {
      user = await prisma.user.findFirst({
        where: { organizationId: ORGANIZATION_ID, OR: [{ name: { contains: 'Bianca', mode: 'insensitive' } }, { email: { contains: 'bianca' } }] },
      });
    }

    if (!user) {
      // Try generic match
      user = await prisma.user.findFirst({
        where: { organizationId: ORGANIZATION_ID, name: { contains: ownerName.split(' ')[0], mode: 'insensitive' } },
      });
    }

    if (!user && key) {
      stats.owners.mappedToImporter++;
      console.log(`  [owner mapped to importer] ${ownerName}`);
    }
    const id = user?.id || adminUser.id;
    userCache.set(key, id);
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

    const projectId = resolveProjectId(clientName, projectTitle);
    if (!projectId) {
      // Try to find any project with this title
      const fallback = await prisma.project.findFirst({
        where: { organizationId: ORGANIZATION_ID, name: { equals: projectTitle, mode: 'insensitive' } },
      });
      if (!fallback) {
        stats.timeEntries.skipped++;
        stats.errors.push(`TimeEntry: no project match for "${projectTitle}" / "${clientName}"`);
        continue;
      }
    }

    const resolvedProjectId = projectId || (await prisma.project.findFirst({
      where: { organizationId: ORGANIZATION_ID, name: { equals: projectTitle, mode: 'insensitive' } },
    }))?.id;

    if (!resolvedProjectId) {
      stats.timeEntries.skipped++;
      continue;
    }

    try {
      const duration = parseFormattedTime(formattedTime);
      if (duration === 0) { stats.timeEntries.skipped++; continue; }

      const date = parseDate(dateStr);
      if (!date) { stats.timeEntries.skipped++; continue; }

      const userId = await resolveUserId(ownerName);
      const rate = parseFloat2(entry.rate);
      const billable = (entry.billing_status || '').toLowerCase() === 'billed';
      const notes = (entry.notes || '').trim();
      const timeEntrySourceKey = [resolvedProjectId, userId, date.toISOString(), duration].join('|');
      if (seenTimeEntryKeys.has(timeEntrySourceKey)) {
        stats.timeEntries.skipped++;
        stats.errors.push(`TimeEntry "${projectTitle}" ${dateStr}: duplicate Bonsai source identity`);
        continue;
      }
      seenTimeEntryKeys.add(timeEntrySourceKey);

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
        stats.timeEntries.existing++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.timeEntry.create({
          data: {
            description: notes || `${projectTitle} work`,
            duration,
            date,
            billable,
            hourlyRate: rate || null,
            projectId: resolvedProjectId,
            userId,
            source: 'BONSAI_IMPORT',
          },
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
  // STEP 5: EXPENSES
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
    const amount = parseFloat2(exp.amount_after_tax || exp.amount_pre_tax);
    const currency = (exp.currency || '').toUpperCase();
    const category = mapExpenseCategory(exp.tags);
    const date = parseDate(exp.date);
    const billable = (exp.billable || '').toLowerCase() === 'true';
    const clientName = (exp.client || '').trim();
    const projectName = (exp.project || '').trim();

    if (!description || amount === 0 || !date || !['CAD', 'USD'].includes(currency)) {
      stats.expenses.skipped++;
      if (description && amount !== 0 && date && !['CAD', 'USD'].includes(currency)) {
        stats.errors.push(`Expense "${description.substring(0, 40)}": currency is missing or unsupported`);
      }
      continue;
    }

    const clientId = clientName ? resolveClientId(clientName) : null;
    // Try to resolve project
    let projectId = null;
    if (projectName && clientName) {
      projectId = resolveProjectId(clientName, projectName);
    }

    try {
      const expenseSourceKey = [description.toLowerCase(), date.toISOString(), amount, currency, clientId || '', projectId || ''].join('|');
      if (seenExpenseKeys.has(expenseSourceKey)) {
        stats.expenses.skipped++;
        stats.errors.push(`Expense "${description.substring(0, 40)}": duplicate Bonsai source identity`);
        continue;
      }
      seenExpenseKeys.add(expenseSourceKey);
      // Dedup: same description + date + amount
      const existing = await prisma.expense.findFirst({
        where: {
          description,
          date,
          amount,
          clientId: clientId || undefined,
        },
      });

      if (existing) {
        stats.expenses.skipped++;
        continue;
      }

      if (!DRY_RUN) {
        await prisma.expense.create({
          data: {
            description,
            amount,
            currency,
            category,
            date,
            billable,
            clientId: clientId || undefined,
            projectId: projectId || undefined,
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
    assertApprovedBonsaiDryRun(approved, { organizationId: ORGANIZATION_ID, sourceFingerprint, planFingerprint });
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
