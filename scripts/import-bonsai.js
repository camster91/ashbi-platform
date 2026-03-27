#!/usr/bin/env node

/**
 * Import Bonsai clients, projects, and invoices into Agency Hub
 *
 * Usage: node scripts/import-bonsai.js
 *
 * Reads from:
 *   - Bonsai project export CSV
 *   - Bonsai invoice export CSV
 *
 * Creates:
 *   - Client records (deduped by name)
 *   - Project records linked to clients
 *   - Contact records from invoice emails
 *
 * NOTE: Review the output before running. This is a one-time import script.
 *       Set DATABASE_URL in your .env to point to the production database.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

// === CONFIG ===
// Update these paths if the CSV files are in a different location
const PROJECT_CSV = path.resolve(__dirname, '../data/ashbidesign_project_export.csv');
const INVOICE_CSV = path.resolve(__dirname, '../data/ashbidesign_invoice_export.csv');

// Fallback: Check Downloads folder
const DOWNLOADS_PROJECT_CSV = 'C:/Users/camst/Downloads/ashbidesign_project_export_2026-03-18_64e13f21c9c88a75e6a9f0ab0c8c.csv';
const DOWNLOADS_INVOICE_CSV = 'C:/Users/camst/Downloads/ashbidesign_invoice_export_2026-03-18_ae32dde2c6004e63b7de2e989ead.csv';

function getProjectCsvPath() {
  if (fs.existsSync(PROJECT_CSV)) return PROJECT_CSV;
  if (fs.existsSync(DOWNLOADS_PROJECT_CSV)) return DOWNLOADS_PROJECT_CSV;
  throw new Error(`Project CSV not found at ${PROJECT_CSV} or ${DOWNLOADS_PROJECT_CSV}`);
}

function getInvoiceCsvPath() {
  if (fs.existsSync(INVOICE_CSV)) return INVOICE_CSV;
  if (fs.existsSync(DOWNLOADS_INVOICE_CSV)) return DOWNLOADS_INVOICE_CSV;
  throw new Error(`Invoice CSV not found at ${INVOICE_CSV} or ${DOWNLOADS_INVOICE_CSV}`);
}

// === CSV PARSER (simple, handles quoted fields) ===
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// === STATUS MAPPING ===
function mapBonsaiStatus(bonsaiStatus) {
  switch (bonsaiStatus?.toLowerCase()) {
    case 'active': return 'DESIGN_DEV'; // Most active projects are in design/dev phase
    case 'completed': return 'LAUNCHED';
    case 'archived': return 'LAUNCHED'; // Archived = done
    default: return 'STARTING_UP';
  }
}

function mapInvoiceStatus(bonsaiStatus) {
  switch (bonsaiStatus?.toLowerCase()) {
    case 'paid': return 'PAID';
    case 'sent': return 'SENT';
    case 'draft': return 'DRAFT';
    case 'overdue': return 'OVERDUE';
    case 'void': return 'VOID';
    default: return 'DRAFT';
  }
}

// === MAIN IMPORT ===
async function main() {
  console.log('=== Bonsai Import Script ===\n');

  // Read CSVs
  const projectCsv = fs.readFileSync(getProjectCsvPath(), 'utf-8');
  const invoiceCsv = fs.readFileSync(getInvoiceCsvPath(), 'utf-8');

  const projects = parseCSV(projectCsv);
  const invoices = parseCSV(invoiceCsv);

  console.log(`Found ${projects.length} projects and ${invoices.length} invoices\n`);

  // === Step 1: Extract unique clients from projects ===
  const clientMap = new Map(); // name -> { name, projects, contacts }

  for (const proj of projects) {
    const clientName = proj.client_or_company_name?.trim();
    if (!clientName) continue;

    if (!clientMap.has(clientName)) {
      clientMap.set(clientName, {
        name: clientName,
        projects: [],
        contacts: [],
      });
    }
    clientMap.get(clientName).projects.push(proj);
  }

  // === Step 2: Extract contacts from invoices ===
  for (const inv of invoices) {
    const clientName = inv.client_or_company_name?.trim();
    const email = inv.client_email?.trim();
    if (!clientName || !email) continue;

    if (!clientMap.has(clientName)) {
      clientMap.set(clientName, {
        name: clientName,
        projects: [],
        contacts: [],
      });
    }

    const client = clientMap.get(clientName);
    if (!client.contacts.find(c => c.email === email)) {
      client.contacts.push({ email, name: clientName });
    }
  }

  console.log(`Found ${clientMap.size} unique clients\n`);

  // === Step 3: Upsert clients ===
  const clientIdMap = new Map(); // clientName -> prisma client id

  for (const [name, data] of clientMap) {
    // Check if client already exists
    let existing = await prisma.client.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } }
    });

    if (existing) {
      console.log(`  [exists] Client: ${name} (${existing.id})`);
      clientIdMap.set(name, existing.id);
    } else {
      const client = await prisma.client.create({
        data: {
          name,
          status: 'ACTIVE',
        }
      });
      console.log(`  [created] Client: ${name} (${client.id})`);
      clientIdMap.set(name, client.id);
    }

    // Upsert contacts
    const clientId = clientIdMap.get(name);
    for (const contact of data.contacts) {
      const existingContact = await prisma.contact.findFirst({
        where: { email: contact.email, clientId }
      });
      if (!existingContact) {
        await prisma.contact.create({
          data: {
            email: contact.email,
            name: contact.name,
            clientId,
            isPrimary: data.contacts.indexOf(contact) === 0,
          }
        });
        console.log(`    [contact] ${contact.email}`);
      }
    }
  }

  // === Step 4: Create projects ===
  let projectCount = 0;
  for (const proj of projects) {
    const clientName = proj.client_or_company_name?.trim();
    const clientId = clientIdMap.get(clientName);
    if (!clientId) {
      console.log(`  [skip] Project "${proj.title}" - no client match`);
      continue;
    }

    const projectTitle = proj.title?.trim();
    if (!projectTitle) continue;

    // Check for existing project with same name and client
    const existing = await prisma.project.findFirst({
      where: {
        name: { equals: projectTitle, mode: 'insensitive' },
        clientId,
      }
    });

    if (existing) {
      console.log(`  [exists] Project: ${projectTitle} (${existing.id})`);
      continue;
    }

    const status = mapBonsaiStatus(proj.status);

    await prisma.project.create({
      data: {
        name: projectTitle,
        description: `Imported from Bonsai (${proj.project_id}). Budget: $${proj.amount_paid || 0} paid, $${proj.amount_due || 0} due.`,
        clientId,
        status,
      }
    });
    projectCount++;
    console.log(`  [created] Project: ${projectTitle} (${status})`);
  }

  // === Step 5: Summary ===
  console.log('\n=== Import Summary ===');
  console.log(`Clients: ${clientMap.size}`);
  console.log(`Projects created: ${projectCount}`);
  console.log(`Invoice records: ${invoices.length} (not imported as Hub invoices - review and create manually)`);

  // Show unpaid/outstanding invoices as a highlight
  const unpaid = invoices.filter(inv => {
    const due = parseFloat(inv.amount_due) || 0;
    return due > 0;
  });

  if (unpaid.length > 0) {
    console.log(`\n=== Outstanding Invoices (${unpaid.length}) ===`);
    let totalUnpaid = 0;
    for (const inv of unpaid) {
      const due = parseFloat(inv.amount_due) || 0;
      totalUnpaid += due;
      console.log(`  ${inv.invoice_number}: ${inv.client_or_company_name} - $${due} ${inv.currency} (${inv.status})`);
    }
    console.log(`  TOTAL OUTSTANDING: $${totalUnpaid.toFixed(2)}`);
  }

  console.log('\nDone! Review the data in Agency Hub.');
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
