#!/usr/bin/env node

/**
 * Controlled importer for MarkUp.io review comments in an operator-prepared
 * `markup-comments.csv`. Playbook: docs/markup-migration.md.
 *
 * Usage:
 *   node scripts/import-markup.mjs --organization-id <id> --project-id <id> --operator-email <email> --input-dir <dir> [--dry-run] [--summary-file <report.json>]
 *   node scripts/import-markup.mjs --organization-id <id> --project-id <id> --operator-email <email> --input-dir <dir> --apply [--summary-file <report.json>]
 *   node scripts/import-markup.mjs --organization-id <id> --rollback <runId> [--summary-file <report.json>]
 *
 * A dry run is the default and makes no writes. All database work runs in the
 * organization's tenant context (runTenantJob). Run it from the application
 * directory: files are stored under ./uploads, like every other upload.
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../src/utils/logger.js';
import { runTenantJob } from '../src/jobs/tenant-iteration.js';
import {
  MarkupImportBlockedError,
  readMarkupImport,
  rollbackMarkupImportRun,
  runMarkupImport,
} from '../src/services/markup-import.service.js';

// Scoped queries log at debug level; keep stdout for the report.
logger.level = process.env.IMPORT_LOG_LEVEL || 'warn';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id') || process.env.IMPORT_ORGANIZATION_ID;
const projectId = option('--project-id');
const inputDir = option('--input-dir');
const operatorEmail = option('--operator-email');
const summaryFile = option('--summary-file');
const rollbackRunId = option('--rollback');
const apply = process.argv.includes('--apply');
const explicitDryRun = process.argv.includes('--dry-run');

const usage = 'Usage: node scripts/import-markup.mjs --organization-id <id> (--project-id <id> --operator-email <email> --input-dir <dir> [--dry-run|--apply] | --rollback <runId>) [--summary-file <report.json>]';
const modes = [apply, explicitDryRun, Boolean(rollbackRunId)].filter(Boolean).length;
if (!organizationId || modes > 1 || (!rollbackRunId && (!inputDir || !operatorEmail || !projectId)) || (process.argv.includes('--rollback') && !rollbackRunId)) {
  console.error(usage);
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function writeReport(report) {
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (summaryFile) {
    const target = path.resolve(summaryFile);
    await fs.writeFile(target, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.chmod(target, 0o600);
  }
  console.log(serialized.trimEnd());
}

async function main() {
  if (rollbackRunId) {
    const report = await runTenantJob(prisma, organizationId, (db) => rollbackMarkupImportRun(db, { organizationId, runId: rollbackRunId }));
    await writeReport(report);
    return;
  }

  const importData = await readMarkupImport(inputDir);
  try {
    const report = await runTenantJob(prisma, organizationId, (db) => runMarkupImport(db, { organizationId, projectId, importData, operatorEmail, apply }));
    await writeReport(report);
    if (!apply) console.log('Dry run complete. Review the report, retain a backup, and rerun with --apply only after reconciliation approval.');
  } catch (error) {
    // A blocked live run wrote nothing; show its findings but no report file.
    if (error instanceof MarkupImportBlockedError) console.error(JSON.stringify({ errors: error.report.errors }, null, 2));
    throw error;
  }
}

main()
  .catch((error) => { console.error(`MarkUp.io import failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
