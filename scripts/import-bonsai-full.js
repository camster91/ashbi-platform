#!/usr/bin/env node

/**
 * Bonsai → Agency Hub Full Import Script
 * 
 * Imports: Clients, Contacts, Projects, Invoices, Time Entries, Expenses
 * from Bonsai CSV exports into the Agency Hub database.
 * 
 * Usage:
 *   node scripts/import-bonsai-full.js --dry-run   # Preview only
 *   node scripts/import-bonsai-full.js              # Live import
 * 
 * Idempotent — safe to run multiple times. Uses upsert/dedup on:
 *   - Clients: by email or name
 *   - Projects: by bonsaiProjectId
 *   - Invoices: by invoiceNumber
 *   - Time entries: by date + project + duration + user
 *   - Expenses: by description + date + amount
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import csvParser from 'csv-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// === CSV Directory ===
const CSV_DIR = '/home/camst/.openclaw/workspace/bonsai-export';

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
      console.log(`  ⚠ File not found: ${filePath}`);
      resolve([]);
      return;
    }
    fs.createReadStream(filePath)
      .pipe(csvParser())
      .on('data', (row) => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}

// === Status Mappings ===
function mapProjectStatus(bonsaiStatus) {
  switch (bonsaiStatus?.toLowerCase()) {
    case 'active': return 'DESIGN_DEV';
    case 'completed': return 'LAUNCHED';
    case 'archived': return 'ON_HOLD';
    default: return 'STARTING_UP';
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
    default: return 'DRAFT';
  }
}

function mapPaymentMethod(bonsaiMethod) {
  switch (bonsaiMethod?.toLowerCase()) {
    case 'credit_card': return 'STRIPE';
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
  errors: []
};

// ======================================================================
// MAIN
// ======================================================================
async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  Bonsai → Hub Full Import ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}\n`);

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
    if (clientName) addressMap.set(clientName.toLowerCase(), addr);
  }

  // Build invoice revenue lookup: client email/name → total paid USD/CAD
  const revenueByClient = new Map(); // name(lower) → { usd, cad }
  for (const inv of invoicesRaw) {
    if (inv.status?.toLowerCase() !== 'paid') continue;
    const name = (inv.client_or_company_name || '').trim().toLowerCase();
    const amount = parseFloat2(inv.paid_amount);
    const currency = (inv.currency || 'USD').toUpperCase();
    if (!revenueByClient.has(name)) revenueByClient.set(name, { usd: 0, cad: 0 });
    const rev = revenueByClient.get(name);
    if (currency === 'CAD') rev.cad += amount;
    else rev.usd += amount;
  }

  // Build email→clientName lookup from invoices
  const emailToClientName = new Map();
  for (const inv of invoicesRaw) {
    const email = (inv.client_email || '').trim().toLowerCase();
    const name = (inv.client_or_company_name || '').trim();
    if (email && name) emailToClientName.set(email, name);
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
    clientDataMap.set(key, {
      name,
      contactName: (row['Contact Name'] || '').trim(),
      contactEmail: (row['Contact Email'] || '').trim().toLowerCase(),
      phone: (row['Phone Number'] || '').trim(),
      website: (row['Website'] || '').trim(),
      tags: (row['Tags'] || '').trim(),
    });
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
    } else if (!clientDataMap.get(key).contactEmail && inv.client_email) {
      clientDataMap.get(key).contactEmail = inv.client_email.trim().toLowerCase();
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
      emailToClientKey.set(data.contactEmail, key);
    }
  }

  // Now upsert clients into DB
  const clientIdMap = new Map(); // normalized name → DB id
  const emailToClientId = new Map(); // email → DB client id

  // Get or create admin user for invoice createdById
  let adminUser = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!adminUser) {
    adminUser = await prisma.user.findFirst();
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
          where: { email: data.contactEmail },
          include: { client: true },
        });
        if (contact) existing = contact.client;
      }
      if (!existing) {
        existing = await prisma.client.findFirst({
          where: { name: { equals: data.name, mode: 'insensitive' } },
        });
      }

      // Revenue & tier
      const rev = revenueByClient.get(key) || { usd: 0, cad: 0 };
      const totalUsdEquiv = rev.usd + rev.cad * 0.74; // rough CAD→USD
      let tier = 'T3';
      if (totalUsdEquiv >= 5000) tier = 'T1';
      else if (totalUsdEquiv >= 2000) tier = 'T2';

      // Address
      const addr = addressMap.get(key);

      const clientData = {
        name: data.name,
        contactPerson: data.contactName || null,
        phone: data.phone || null,
        domain: data.website || null,
        tier,
        totalRevenueUsd: rev.usd,
        totalRevenueCad: rev.cad,
        country: addr?.Country || 'US',
        address: addr ? [addr['Address 1'], addr['Address 2']].filter(Boolean).join(', ') : null,
        city: addr?.City || null,
        provinceState: addr?.Region || null,
        postalCode: addr ? addr['Postal Code'] : null,
      };

      if (existing) {
        if (!DRY_RUN) {
          await prisma.client.update({ where: { id: existing.id }, data: clientData });
        }
        clientIdMap.set(key, existing.id);
        if (data.contactEmail) emailToClientId.set(data.contactEmail, existing.id);
        stats.clients.existing++;
      } else {
        if (!DRY_RUN) {
          // Remove domain if it would conflict
          if (clientData.domain) {
            const domainConflict = await prisma.client.findFirst({ where: { domain: clientData.domain } });
            if (domainConflict) clientData.domain = null;
          }
          const created = await prisma.client.create({ data: clientData });
          clientIdMap.set(key, created.id);
          if (data.contactEmail) emailToClientId.set(data.contactEmail, created.id);
        }
        stats.clients.created++;
        if (DRY_RUN) console.log(`  [would create] ${data.name} (${tier})`);
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

  console.log(`  ✅ Clients: ${stats.clients.created} created, ${stats.clients.existing} updated, ${stats.clients.skipped} skipped`);
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

  for (const proj of projectsRaw) {
    const clientName = (proj.client_or_company_name || '').trim();
    const title = (proj.title || '').trim();
    const bonsaiId = (proj.project_id || '').trim();

    if (!title || shouldSkipClient(clientName)) {
      stats.projects.skipped++;
      continue;
    }

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
        existing = await prisma.project.findFirst({ where: { bonsaiProjectId: bonsaiId } });
      }
      if (!existing) {
        existing = await prisma.project.findFirst({
          where: { name: { equals: title, mode: 'insensitive' }, clientId },
        });
      }

      const status = mapProjectStatus(proj.status);
      const budget = parseFloat2(proj.project_budget_amount) || parseFloat2(proj.amount_paid) || null;
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
        if (!DRY_RUN) {
          await prisma.project.update({ where: { id: existing.id }, data: projectData });
        }
        projectIdMap.set(bonsaiId, existing.id);
        projectLookup.set(`${clientName.toLowerCase()}|${title.toLowerCase()}`, existing.id);
        stats.projects.existing++;
      } else {
        if (!DRY_RUN) {
          const created = await prisma.project.create({ data: projectData });
          projectIdMap.set(bonsaiId, created.id);
          projectLookup.set(`${clientName.toLowerCase()}|${title.toLowerCase()}`, created.id);
        }
        stats.projects.created++;
        if (DRY_RUN) console.log(`  [would create] ${title} → ${clientName} (${status})`);
      }
    } catch (err) {
      stats.errors.push(`Project "${title}": ${err.message}`);
    }
  }

  console.log(`  ✅ Projects: ${stats.projects.created} created, ${stats.projects.existing} updated, ${stats.projects.skipped} skipped`);

  // Helper: resolve project ID
  function resolveProjectId(clientName, projectTitle) {
    const key = `${(clientName || '').trim().toLowerCase()}|${(projectTitle || '').trim().toLowerCase()}`;
    return projectLookup.get(key) || null;
  }

  // ============================================================
  // STEP 3: INVOICES
  // ============================================================
  console.log('\n💰 Importing Invoices...');

  for (const inv of invoicesRaw) {
    const invoiceNumber = (inv.invoice_number || '').trim();
    const clientName = (inv.client_or_company_name || '').trim();
    const clientEmail = (inv.client_email || '').trim();

    if (!invoiceNumber || shouldSkipClient(clientName)) {
      stats.invoices.skipped++;
      continue;
    }

    const clientId = resolveClientId(clientName, clientEmail);
    if (!clientId) {
      stats.invoices.skipped++;
      stats.errors.push(`Invoice #${invoiceNumber}: no client match for "${clientName}"`);
      continue;
    }

    try {
      // Dedup by invoiceNumber
      const existing = await prisma.invoice.findFirst({
        where: { invoiceNumber },
      });

      if (existing) {
        stats.invoices.existing++;
        continue;
      }

      const status = mapInvoiceStatus(inv.status);
      const totalAmount = parseFloat2(inv.total_amount);
      const tax = parseFloat2(inv.calculated_tax_amount);
      const taxRate = parseFloat2(inv.calculated_tax_percent);
      const subtotal = totalAmount - tax;
      const currency = (inv.currency || 'USD').toUpperCase();
      const issueDate = parseDate(inv.issued_date) || new Date();
      const dueDate = parseDate(inv.due_date);
      const paidDate = parseDate(inv.paid_date);
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

  // Find or create users for Cameron and Bianca
  const userCache = new Map(); // owner_name(lower) → userId

  async function resolveUserId(ownerName) {
    const key = (ownerName || '').trim().toLowerCase();
    if (userCache.has(key)) return userCache.get(key);

    let user = null;
    if (key.includes('cameron')) {
      user = await prisma.user.findFirst({
        where: { OR: [{ name: { contains: 'Cameron', mode: 'insensitive' } }, { email: { contains: 'cameron' } }] },
      });
    } else if (key.includes('bianca')) {
      user = await prisma.user.findFirst({
        where: { OR: [{ name: { contains: 'Bianca', mode: 'insensitive' } }, { email: { contains: 'bianca' } }] },
      });
    }

    if (!user) {
      // Try generic match
      user = await prisma.user.findFirst({
        where: { name: { contains: ownerName.split(' ')[0], mode: 'insensitive' } },
      });
    }

    if (!user && !DRY_RUN) {
      // Create user
      const email = key.includes('bianca') ? 'bianca@ashbi.ca' : key.includes('cameron') ? 'cameron@ashbi.ca' : `${key.replace(/\s+/g, '.')}@ashbi.ca`;
      user = await prisma.user.create({
        data: {
          name: ownerName.trim(),
          email,
          password: 'imported-no-login',
          role: 'TEAM',
        },
      });
      console.log(`  [created user] ${user.name} (${user.email})`);
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
        where: { name: { equals: projectTitle, mode: 'insensitive' } },
      });
      if (!fallback) {
        stats.timeEntries.skipped++;
        stats.errors.push(`TimeEntry: no project match for "${projectTitle}" / "${clientName}"`);
        continue;
      }
    }

    const resolvedProjectId = projectId || (await prisma.project.findFirst({
      where: { name: { equals: projectTitle, mode: 'insensitive' } },
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
    const currency = (exp.currency || 'USD').toUpperCase();
    const category = mapExpenseCategory(exp.tags);
    const date = parseDate(exp.date);
    const billable = (exp.billable || '').toLowerCase() === 'true';
    const clientName = (exp.client || '').trim();
    const projectName = (exp.project || '').trim();

    if (!description || amount === 0 || !date) {
      stats.expenses.skipped++;
      continue;
    }

    const clientId = clientName ? resolveClientId(clientName) : null;
    // Try to resolve project
    let projectId = null;
    if (projectName && clientName) {
      projectId = resolveProjectId(clientName, projectName);
    }

    try {
      // Dedup: same description + date + amount
      const existing = await prisma.expense.findFirst({
        where: {
          description,
          date,
          amount,
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

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  IMPORT SUMMARY ${DRY_RUN ? '(DRY RUN — nothing written)' : '(LIVE)'}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`  Clients:      ${stats.clients.created} new, ${stats.clients.existing} updated, ${stats.clients.skipped} skipped`);
  console.log(`  Contacts:     ${stats.contacts.created} new, ${stats.contacts.existing} existing`);
  console.log(`  Projects:     ${stats.projects.created} new, ${stats.projects.existing} updated, ${stats.projects.skipped} skipped`);
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

  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
