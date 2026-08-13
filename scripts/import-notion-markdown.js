#!/usr/bin/env node

/**
 * Controlled importer for a Notion Markdown export directory.
 * Usage: node scripts/import-notion-markdown.js --organization-id <id> --project-id <id> --input-dir <export> --summary-file <report.json> [--confirm]
 * Without --confirm this command is a dry run and makes no writes.
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildNotionMarkdownImportPlan } from '../src/services/notion-markdown-import.service.js';

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

async function listExportFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listExportFiles(fullPath);
    return entry.isFile() ? [fullPath] : [];
  }));
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

function titleFromRelativePath(relativePath) {
  return path.basename(relativePath, path.extname(relativePath)).replace(/\s+[0-9a-f]{32}$/i, '').trim() || 'Untitled import';
}

function contentSha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  const resolvedInput = path.resolve(inputDir);
  const stat = await fs.stat(resolvedInput);
  if (!stat.isDirectory()) throw new Error(`Input is not a directory: ${resolvedInput}`);

  const [organization, project, importer, exportFiles] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true } }),
    prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true, name: true } }),
    prisma.user.findFirst({ where: { organizationId }, orderBy: { createdAt: 'asc' }, select: { id: true, email: true } }),
    listExportFiles(resolvedInput),
  ]);
  if (!organization) throw new Error(`Organization not found: ${organizationId}`);
  if (!project) throw new Error('Project was not found in the supplied organization');
  if (!importer) throw new Error('No user is available in the supplied organization to own imported notes');

  const relativeFiles = exportFiles.map((filename) => path.relative(resolvedInput, filename));
  const markdownPaths = relativeFiles.filter((relativePath) => relativePath.toLowerCase().endsWith('.md'));
  const plan = buildNotionMarkdownImportPlan(markdownPaths);
  const payloads = await Promise.all(plan.map(async (entry) => {
    const content = await fs.readFile(path.join(resolvedInput, entry.relativePath), 'utf8');
    return { ...entry, content, contentSha256: contentSha256(content), title: titleFromRelativePath(entry.relativePath) };
  }));
  const unsupportedFiles = relativeFiles.filter((relativePath) => !relativePath.toLowerCase().endsWith('.md'));

  const report = {
    format: 'ashbi-notion-markdown-import-report',
    version: 2,
    generatedAt: new Date().toISOString(),
    mode: dryRun ? 'dry-run' : 'live',
    organization: { id: organization.id, name: organization.name },
    project: { id: project.id, name: project.name },
    input: { directory: resolvedInput, markdownFiles: payloads.length, unsupportedFiles },
    notes: { planned: 0, created: 0, unchanged: 0, conflicts: 0, skipped: 0 },
    hierarchy: { planned: [], unresolved: [] },
    records: { created: 0, existing: 0 },
    errors: [],
  };
  const noteIdBySourceKey = new Map();

  const processPayloads = async (db, allowWrites) => {
    for (const item of payloads) {
      if (!item.content.trim()) {
        report.notes.skipped++;
        report.errors.push({ sourceKey: item.sourceKey, code: 'EMPTY_PAGE', error: 'Markdown page is empty' });
        continue;
      }
      const existingRecord = await db.notionImportRecord.findUnique({
        where: { projectId_sourceKey: { projectId, sourceKey: item.sourceKey } },
      });
      if (existingRecord) {
        report.records.existing++;
        const existingNote = existingRecord.noteId
          ? await db.note.findFirst({ where: { id: existingRecord.noteId, projectId, deletedAt: null }, select: { id: true } })
          : null;
        if (!existingNote) {
          report.notes.conflicts++;
          report.errors.push({ sourceKey: item.sourceKey, code: 'MISSING_DESTINATION', error: 'The prior imported note is unavailable' });
          continue;
        }
        noteIdBySourceKey.set(item.sourceKey, existingNote.id);
        if (existingRecord.contentSha256 === item.contentSha256) {
          report.notes.unchanged++;
          continue;
        }
        report.notes.conflicts++;
        report.errors.push({ sourceKey: item.sourceKey, code: 'SOURCE_CHANGED', error: 'Source content changed since its prior controlled import' });
        continue;
      }

      const parentId = item.parentSourceKey ? noteIdBySourceKey.get(item.parentSourceKey) : null;
      if (item.parentSourceKey && !parentId) {
        report.notes.conflicts++;
        report.hierarchy.unresolved.push({ sourceKey: item.sourceKey, parentSourceKey: item.parentSourceKey });
        report.errors.push({ sourceKey: item.sourceKey, code: 'PARENT_UNRESOLVED', error: 'The Notion parent page was not available for this import' });
        continue;
      }
      const destinationConflict = await db.note.findFirst({
        where: { projectId, title: item.title, parentId: parentId || null, deletedAt: null }, select: { id: true },
      });
      if (destinationConflict) {
        report.notes.conflicts++;
        report.errors.push({ sourceKey: item.sourceKey, code: 'DESTINATION_CONFLICT', error: 'An unmapped Ashbi note already has this title and parent' });
        continue;
      }

      report.hierarchy.planned.push({ sourceKey: item.sourceKey, parentSourceKey: item.parentSourceKey });
      if (!allowWrites) {
        noteIdBySourceKey.set(item.sourceKey, `planned:${item.sourceKey}`);
        report.notes.planned++;
        continue;
      }
      const created = await db.note.create({
        data: { title: item.title, content: item.content, type: 'DOC', projectId, parentId: parentId || null, authorId: importer.id },
      });
      await db.notionImportRecord.create({
        data: {
          organizationId, projectId, noteId: created.id, sourceKey: item.sourceKey,
          sourcePath: item.relativePath, contentSha256: item.contentSha256, outcome: 'IMPORTED',
        },
      });
      noteIdBySourceKey.set(item.sourceKey, created.id);
      report.notes.created++;
      report.records.created++;
    }
  };

  if (dryRun) {
    await processPayloads(prisma, false);
  } else {
    await prisma.$transaction(async (transaction) => {
      await processPayloads(transaction, true);
      if (report.errors.length > 0 || unsupportedFiles.length > 0) {
        throw new Error('Live import cannot complete with unresolved reconciliation findings');
      }
    });
  }

  report.complete = report.errors.length === 0 && unsupportedFiles.length === 0;
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (summaryFile) {
    const target = path.resolve(summaryFile);
    await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.chmod(target, 0o600);
    report.summaryFile = target;
  }
  console.log(JSON.stringify(report, null, 2));
  if (dryRun) console.log('Dry run complete. Review the report, retain a backup, and rerun with --confirm only after reconciliation approval.');
}

main().catch((error) => { console.error(`Notion import failed: ${error.message}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
