import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { purgeFixtureAuditEvents } from '../helpers/audit-cleanup.js';

// Runs the real Bonsai CLI against a real PostgreSQL database with two
// organizations to prove that the dry run predicts the live run: findings
// make a dry run incomplete, a domain held by another organization (or by
// another client of the same export) is reported rather than failing only
// live, expenses stay inside the importing organization, blank owners are
// unmatched, the fallback admin is chosen deterministically, duplicate time
// entries in one export are counted the same way in both modes, and an
// existing report path stops a live run before anything is written.
const databaseUrl = process.env.TENANT_INTEGRATION_DATABASE_URL;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const importer = path.join(repoRoot, 'scripts', 'import-bonsai-full.js');

function writeCsv(dir, name, header, rows = []) {
  const quote = (value) => (/[",\n]/.test(String(value)) ? `"${String(value).replaceAll('"', '""')}"` : String(value));
  fs.writeFileSync(path.join(dir, name), `${[header, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`);
}

function runCli(args, workDir, summaryFile = path.join(workDir, `report-${randomUUID()}.json`)) {
  const existedBefore = fs.existsSync(summaryFile);
  const result = spawnSync(process.execPath, [importer, ...args, '--summary-file', summaryFile], {
    cwd: workDir,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: 'development' },
  });
  const report = !existedBefore && fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : null;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

test('Bonsai import reports findings in the dry run, stays inside its tenant and matches the live run', {
  skip: !databaseUrl && 'TENANT_INTEGRATION_DATABASE_URL is not configured',
  timeout: 180_000,
}, async () => {
  const { PrismaClient } = prismaPkg;
  const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const suffix = randomUUID();
  const ids = {
    orgA: `bonsai-org-a-${suffix}`, orgB: `bonsai-org-b-${suffix}`,
    existingA: `bonsai-client-a-${suffix}`, clientB: `bonsai-client-b-${suffix}`,
    inactiveAdmin: `bonsai-inactive-${suffix}`, oldestAdmin: `bonsai-oldest-${suffix}`, newerAdmin: `bonsai-newer-${suffix}`,
    userB: `bonsai-user-b-${suffix}`, expenseB: `bonsai-expense-b-${suffix}`,
  };
  const domains = { orgB: `taken-${suffix}.example`, twin: `twin-${suffix}.example`, existingA: `existing-${suffix}.example` };
  const existingEmail = `existing+${suffix}@example.test`;
  const hosting = `Hosting ${suffix}`;
  const figma = `Figma ${suffix}`;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ashbi-bonsai-import-'));
  const csvDir = path.join(workDir, 'export');
  const errorDir = path.join(workDir, 'export-with-error');
  fs.mkdirSync(csvDir);
  fs.mkdirSync(errorDir);

  const writeExport = (dir, extraTimeEntries = []) => {
    writeCsv(dir, 'clients.csv', ['Client', 'Contact Name', 'Contact Email', 'Phone Number', 'Website', 'Tags'], [
      // Update path: the matched client's new website belongs to org B.
      ['Existing Co', 'Erin', existingEmail, '', domains.orgB, ''],
      // Create path: org B already holds this domain.
      ['New Co', 'Nina', '', '', domains.orgB, ''],
      // Two clients of the same export share one website.
      ['Twin One', 'Tom', '', '', domains.twin, ''],
      ['Twin Two', 'Tim', '', '', domains.twin, ''],
    ]);
    writeCsv(dir, 'addresses.csv', ['Client', 'Address 1', 'Address 2', 'City', 'Region', 'Postal Code', 'Country']);
    writeCsv(dir, 'projects.csv', ['client_or_company_name', 'title', 'project_id', 'status', 'project_budget_amount', 'amount_paid', 'start_date', 'finish_date'], [
      ['New Co', 'Site', `site-${suffix}`, 'active', '1000', '', '2025-01-01', ''],
    ]);
    writeCsv(dir, 'invoices.csv', ['invoice_number', 'client_or_company_name', 'client_email', 'status', 'total_amount', 'calculated_tax_amount', 'calculated_tax_percent', 'paid_amount', 'currency', 'issued_date', 'due_date', 'paid_date', 'payment_method', 'contractor_invoice_link', 'contractor_project_name'], [
      [`INV-${suffix}`, 'New Co', '', 'sent', '100', '0', '0', '0', 'USD', '2025-02-01', '2025-03-01', '', '', '', 'Site'],
    ]);
    writeCsv(dir, 'time-entries.csv', ['client_name', 'project_title', 'owner_name', 'date', 'formatted_time', 'rate', 'billing_status', 'notes'], [
      ['New Co', 'Site', 'Amy Admin', '2025-02-03', '01:00:00', '100', 'billed', 'Design'],
      // The same entry twice in one export.
      ['New Co', 'Site', 'Amy Admin', '2025-02-03', '01:00:00', '100', 'billed', 'Design'],
      // A blank owner must not match an arbitrary user.
      ['New Co', 'Site', '', '2025-02-04', '02:00:00', '100', 'billed', 'Build'],
      ...extraTimeEntries,
    ]);
    writeCsv(dir, 'expenses.csv', ['name', 'amount_after_tax', 'amount_pre_tax', 'currency', 'date', 'tags', 'billable', 'client', 'project'], [
      // Same description, date and amount as an org B expense.
      [hosting, '20', '20', 'USD', '2025-02-05', 'software', 'false', 'New Co', 'Site'],
      // No client: the schema can only link an expense to a tenant through its client.
      [figma, '15', '15', 'USD', '2025-02-06', 'software', 'false', '', ''],
    ]);
  };
  writeExport(csvDir);
  writeExport(errorDir, [['New Co', 'No such project', 'Amy Admin', '2025-02-07', '01:00:00', '100', 'billed', '']]);
  const base = ['--organization-id', ids.orgA];

  try {
    await raw.organization.createMany({ data: [
      { id: ids.orgA, name: 'Bonsai import tenant A', slug: `bonsai-a-${suffix}` },
      { id: ids.orgB, name: 'Bonsai import tenant B', slug: `bonsai-b-${suffix}` },
    ] });
    await raw.client.createMany({ data: [
      { id: ids.existingA, organizationId: ids.orgA, name: 'Existing Co', domain: domains.existingA },
      { id: ids.clientB, organizationId: ids.orgB, name: 'Tenant B client', domain: domains.orgB },
    ] });
    await raw.contact.create({ data: { clientId: ids.existingA, email: existingEmail, name: 'Erin', isPrimary: true } });
    await raw.user.createMany({ data: [
      // Oldest ADMIN, but inactive: never the fallback.
      { id: ids.inactiveAdmin, organizationId: ids.orgA, email: `inactive+${suffix}@example.test`, password: 'test', name: 'Ivan Inactive', role: 'ADMIN', isActive: false, createdAt: new Date('2019-01-01T00:00:00Z') },
      { id: ids.newerAdmin, organizationId: ids.orgA, email: `amy+${suffix}@example.test`, password: 'test', name: 'Amy Admin', role: 'ADMIN', createdAt: new Date('2024-01-01T00:00:00Z') },
      { id: ids.oldestAdmin, organizationId: ids.orgA, email: `zed+${suffix}@example.test`, password: 'test', name: 'Zed Oldest', role: 'ADMIN', createdAt: new Date('2020-01-01T00:00:00Z') },
      { id: ids.userB, organizationId: ids.orgB, email: `b+${suffix}@example.test`, password: 'test', name: 'Tenant B user', role: 'ADMIN' },
    ] });
    await raw.expense.create({ data: { id: ids.expenseB, clientId: ids.clientB, description: hosting, amount: 20, date: new Date('2025-02-05'), category: 'SOFTWARE' } });
    await raw.expense.create({ data: { clientId: ids.clientB, description: figma, amount: 15, date: new Date('2025-02-06'), category: 'SOFTWARE' } });

    const orgBSnapshot = async () => ({
      clients: await raw.client.findMany({ where: { organizationId: ids.orgB }, orderBy: { id: 'asc' } }),
      expenses: await raw.expense.findMany({ where: { client: { organizationId: ids.orgB } }, orderBy: { id: 'asc' } }),
    });
    const before = await orgBSnapshot();

    // 1. A finding makes a dry run incomplete.
    const failing = runCli(['--dry-run', ...base, '--csv-dir', errorDir], workDir);
    assert.equal(failing.status, 0, failing.stderr);
    assert.ok(failing.report.stats.errors.some((message) => message.includes('No such project')));
    assert.equal(failing.report.complete, false);

    // 2. The dry run of the clean export.
    const dry = runCli(['--dry-run', ...base, '--csv-dir', csvDir], workDir);
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(dry.report.stats.errors, []);
    assert.equal(dry.report.complete, true);
    const domainWarnings = dry.report.stats.warnings.filter((warning) => warning.code === 'CLIENT_DOMAIN_TAKEN');
    assert.deepEqual(domainWarnings.map((warning) => warning.client).sort(), ['Existing Co', 'New Co', 'Twin Two']);
    // Nothing identifies the other organization or its client.
    const serialized = JSON.stringify(dry.report);
    assert.ok(!serialized.includes(ids.orgB) && !serialized.includes(ids.clientB) && !serialized.includes('Tenant B'));
    assert.deepEqual(dry.report.stats.warnings.filter((warning) => warning.code === 'EXPENSE_NO_CLIENT').map((warning) => warning.description), [figma]);
    assert.deepEqual(dry.report.stats.expenses, { created: 1, skipped: 1 });
    assert.deepEqual(dry.report.stats.timeEntries, { created: 2, existing: 0, skipped: 0, duplicates: 1 });
    assert.equal(dry.report.stats.owners.mappedToImporter, 1);
    assert.equal(await raw.client.count({ where: { organizationId: ids.orgA } }), 1, 'a dry run writes nothing');

    // 3. An existing report path stops a live run before any write.
    const occupied = path.join(workDir, 'occupied.json');
    fs.writeFileSync(occupied, 'earlier evidence\n');
    const refused = runCli(['--confirm', ...base, '--csv-dir', csvDir], workDir, occupied);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /already exists/);
    assert.equal(fs.readFileSync(occupied, 'utf8'), 'earlier evidence\n');
    assert.equal(await raw.client.count({ where: { organizationId: ids.orgA } }), 1, 'the refused live run wrote nothing');

    // 4. The live run commits and reports the same counts as the dry run.
    const live = runCli(['--confirm', ...base, '--csv-dir', csvDir], workDir);
    assert.equal(live.status, 0, live.stderr);
    assert.equal(live.report.complete, true);
    assert.deepEqual(live.report.stats.errors, []);
    for (const key of ['clients', 'contacts', 'projects', 'invoices', 'timeEntries', 'expenses', 'owners']) {
      assert.deepEqual(live.report.stats[key], dry.report.stats[key], `${key} differ between dry and live run`);
    }
    assert.deepEqual(live.report.stats.warnings, dry.report.stats.warnings);

    const clientsA = await raw.client.findMany({ where: { organizationId: ids.orgA }, orderBy: { name: 'asc' } });
    const byName = Object.fromEntries(clientsA.map((client) => [client.name, client]));
    assert.equal(byName['Existing Co'].domain, domains.existingA, 'a taken domain is not written on update');
    assert.equal(byName['New Co'].domain, null, 'a taken domain is not written on create');
    assert.equal(byName['Twin One'].domain, domains.twin);
    assert.equal(byName['Twin Two'].domain, null);

    const expensesA = await raw.expense.findMany({ where: { client: { organizationId: ids.orgA } } });
    assert.deepEqual(expensesA.map((expense) => expense.description), [hosting]);
    assert.equal(await raw.expense.count({ where: { description: figma, clientId: null } }), 0, 'no expense is stored without a tenant link');

    const project = await raw.project.findFirst({ where: { organizationId: ids.orgA, name: 'Site' } });
    const entries = await raw.timeEntry.findMany({ where: { projectId: project.id }, orderBy: { date: 'asc' } });
    assert.deepEqual(entries.map((entry) => entry.userId), [ids.newerAdmin, ids.oldestAdmin]);
    const invoice = await raw.invoice.findFirst({ where: { invoiceNumber: `INV-${suffix}` } });
    assert.equal(invoice.createdById, ids.oldestAdmin, 'the fallback admin is the oldest active ADMIN');

    // 5. A rerun finds everything, and org B is untouched throughout.
    const rerun = runCli(['--dry-run', ...base, '--csv-dir', csvDir], workDir);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.equal(rerun.report.stats.timeEntries.created, 0);
    assert.equal(rerun.report.stats.timeEntries.existing, 2);
    assert.equal(rerun.report.stats.timeEntries.duplicates, 1);
    assert.equal(rerun.report.stats.expenses.created, 0);
    assert.deepEqual(await orgBSnapshot(), before);
  } finally {
    const orgs = [ids.orgA, ids.orgB];
    await raw.timeEntry.deleteMany({ where: { project: { organizationId: { in: orgs } } } });
    await raw.expense.deleteMany({ where: { OR: [{ client: { organizationId: { in: orgs } } }, { description: { in: [hosting, figma] } }] } });
    await raw.invoiceLineItem.deleteMany({ where: { invoice: { client: { organizationId: { in: orgs } } } } });
    await raw.invoice.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
    await raw.project.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.contact.deleteMany({ where: { client: { organizationId: { in: orgs } } } });
    await raw.client.deleteMany({ where: { organizationId: { in: orgs } } });
    await raw.user.deleteMany({ where: { organizationId: { in: orgs } } });
    await purgeFixtureAuditEvents(raw, { ids: orgs });
    await raw.organization.deleteMany({ where: { id: { in: orgs } } });
    await raw.$disconnect();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
