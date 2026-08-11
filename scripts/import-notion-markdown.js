#!/usr/bin/env node

/**
 * Controlled importer for a Notion Markdown export directory.
 * Usage: node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <export> --summary-file <report.json> [--confirm]
 * Without --confirm this command is a dry run and makes no writes.
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id') || process.env.IMPORT_ORGANIZATION_ID;
const projectId = option('--project-id');
const inputDir = option('--input-dir') || process.env.NOTION_EXPORT_DIR;
const summaryFile = option('--summary-file');
const dryRun = !process.argv.includes('--confirm');

if (!organizationId || !projectId || !inputDir) {
  console.error('Usage: node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <export> [--summary-file <report.json>] [--confirm]');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function listMarkdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listMarkdownFiles(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [fullPath] : [];
  }));
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function titleFromFilename(filename) {
  return path.basename(filename, path.extname(filename)).replace(/\s+[0-9a-f]{32}$/i, '').trim() || 'Untitled import';
}

function storeImportedPath(importedByPath, relative, id) {
  importedByPath.set(relative, id);
  importedByPath.set(path.join(path.dirname(relative), path.basename(relative, path.extname(relative))), id);
}

async function main() {
  const resolvedInput = path.resolve(inputDir);
  const stat = await fs.stat(resolvedInput);
  if (!stat.isDirectory()) throw new Error(`Input is not a directory: ${resolvedInput}`);

  const [organization, project, importer, files] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
    prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true } }),
    prisma.user.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true } }),
    listMarkdownFiles(resolvedInput),
  ]);
  if (!organization) throw new Error(`Organization not found: ${organizationId}`);
  if (!project) throw new Error('Project was not found in the supplied organization');
  if (!importer) throw new Error('No user is available in the supplied organization to own imported notes');

  const report = {
    format: 'ashbi-notion-markdown-import-report',
    generatedAt: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'live',
    organization: { id: organization.id, name: organization.name },
    project: { id: project.id, name: project.name },
    input: { directory: resolvedInput, markdownFiles: files.length },
    notes: { created: 0, existing: 0, skipped: 0 },
    errors: [],
  };
  const importedByPath = new Map();

  for (const filename of files) {
    const relative = path.relative(resolvedInput, filename);
    try {
      const content = await fs.readFile(filename, 'utf8');
      if (!content.trim()) { report.notes.skipped++; continue; }
      const parentDirectory = path.dirname(relative);
      const parentId = importedByPath.get(parentDirectory) || null;
      const title = titleFromFilename(filename);
      const existing = await prisma.note.findFirst({ where: { projectId, title, parentId, deletedAt: null }, select: { id: true } });
      if (existing) {
        storeImportedPath(importedByPath, relative, existing.id);
        report.notes.existing++;
        continue;
      }
      if (!dryRun) {
        const created = await prisma.note.create({ data: { title, content, type: 'DOC', projectId, parentId, authorId: importer.id } });
        storeImportedPath(importedByPath, relative, created.id);
      }
      report.notes.created++;
    } catch (error) {
      report.notes.skipped++;
      report.errors.push({ file: relative, error: error.message });
    }
  }

  report.complete = report.errors.length === 0;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (summaryFile) {
    const target = path.resolve(summaryFile);
    await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.chmod(target, 0o600);
    report.summaryFile = target;
  }
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) console.log('Dry run complete. Review this report, retain a backup, and rerun with --confirm only after reconciliation approval.');
}

main().catch((error) => { console.error(`Notion import failed: ${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
