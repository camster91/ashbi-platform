#!/usr/bin/env node

/**
 * Operator-only, tenant-scoped workspace export (docs/workspace-export.md).
 * Runs with database credentials, never from a user session.
 *
 * Offboarding export (directory, including uploaded files):
 *   node scripts/export-workspace.js --organization-id <id> --output-dir <new-or-empty-dir> \
 *     [--include-files | --no-files] [--uploads-dir <dir>] [--page-size <n>]
 *
 * Legacy migration snapshot (single v2 JSON file with clients, contacts,
 * projects, tasks, notes and milestones; verified by verify-workspace-export.js):
 *   node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm
 *
 * Neither mode exports credentials, sessions or other secrets; see
 * EXCLUDED_MODELS and EXCLUDED_FIELD_REASONS in
 * src/services/workspace-export.service.js.
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildWorkspaceExportManifest } from '../src/services/workspace-export-integrity.service.js';
import { exportWorkspace, parseExportArgs } from '../src/services/workspace-export.service.js';

const { PrismaClient } = prismaPkg;
const USAGE = [
  'Usage: node scripts/export-workspace.js --organization-id <id> --output-dir <new-dir> [--include-files|--no-files] [--uploads-dir <dir>] [--page-size <n>]',
  '   or: node scripts/export-workspace.js --organization-id <id> --output <new-file.json> --confirm   (legacy v2 snapshot)',
].join('\n');

const options = parseExportArgs(process.argv.slice(2), process.env);
if ('error' in options) {
  console.error(`${options.error}\n${USAGE}`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(2);
}

// A raw client: the application's soft-delete wrapper caps findMany at 100
// rows, so every query here states its own organization and deletedAt filter.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function legacyExport(organizationId, output) {
  const target = path.resolve(output);
  try { await fs.access(target); throw new Error(`Refusing to overwrite existing file: ${target}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } });
  if (!organization) throw new Error(`Organization not found: ${organizationId}`);

  const clients = await prisma.client.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, name: true, email: true, domain: true, status: true, contactPerson: true, phone: true, address: true, city: true, provinceState: true, postalCode: true, country: true, serviceType: true, createdAt: true, updatedAt: true },
    orderBy: { name: 'asc' },
  });
  const contacts = await prisma.contact.findMany({ where: { client: { organizationId, deletedAt: null } }, select: { id: true, clientId: true, email: true, name: true, role: true, isPrimary: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } });
  const projects = await prisma.project.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, clientId: true, name: true, description: true, status: true, health: true, healthScore: true, budget: true, hourlyBudget: true, serviceType: true, startDate: true, endDate: true, completedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const projectIds = projects.map(({ id }) => id);
  const [tasks, notes, milestones] = await Promise.all([
    prisma.task.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, parentId: true, title: true, description: true, content: true, status: true, priority: true, category: true, tags: true, properties: true, dueDate: true, startDate: true, completedAt: true, position: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.note.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { id: true, projectId: true, parentId: true, title: true, content: true, type: true, isPinned: true, tags: true, isTemplate: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
    prisma.milestone.findMany({ where: { projectId: { in: projectIds } }, select: { id: true, projectId: true, name: true, description: true, dueDate: true, status: true, completedAt: true, color: true, createdAt: true, updatedAt: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const payload = { format: 'ashbi-workspace-export', version: 2, exportedAt: new Date().toISOString(), organization, records: { clients, contacts, projects, tasks, notes, milestones } };
  payload.manifest = buildWorkspaceExportManifest(payload.records);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  await fs.chmod(target, 0o600);
  console.log(JSON.stringify({ output: target, bytes: Buffer.byteLength(serialized), sha256: crypto.createHash('sha256').update(serialized).digest('hex'), manifest: payload.manifest }, null, 2));
}

async function directoryExport() {
  const result = await exportWorkspace({
    prisma,
    organizationId: options.organizationId,
    outputDir: options.outputDir,
    includeFiles: options.includeFiles,
    uploadsDir: options.uploadsDir ?? undefined,
    pageSize: options.pageSize,
  });
  const { manifest } = result;
  console.log(JSON.stringify({
    outputDir: result.outputDir,
    organizationId: manifest.organizationId,
    manifestSha256: result.manifestSha256,
    totals: manifest.totals,
    exceptions: manifest.exceptions.map(({ code, source, recordId }) => ({ code, source, recordId })),
  }, null, 2));
  if (manifest.exceptions.length > 0) {
    console.error(`Export completed with ${manifest.exceptions.length} exception(s); review manifest.json "exceptions" before handing it over.`);
  }
}

async function main() {
  if (options.mode === 'legacy') await legacyExport(options.organizationId, options.output);
  else await directoryExport();
}

main().catch((error) => { console.error(`Export failed: ${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
