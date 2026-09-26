#!/usr/bin/env node

/**
 * Controlled importer for an extracted Slack workspace export directory.
 * Playbook: docs/slack-export-migration.md.
 *
 * Usage:
 *   node scripts/import-slack-export.mjs --organization-id <id> --input-dir <export> --mapping-file <mapping.json> [--channel <name|id>] [--dry-run] [--summary-file <report.json>]
 *   node scripts/import-slack-export.mjs --organization-id <id> --input-dir <export> --mapping-file <mapping.json> [--channel <name|id>] --apply [--summary-file <report.json>]
 *   node scripts/import-slack-export.mjs --organization-id <id> --rollback <runId> [--summary-file <report.json>]
 *
 * A dry run is the default and makes no writes. All database work runs in the
 * organization's tenant context (runTenantJob).
 */
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import logger from '../src/utils/logger.js';
import { runTenantJob } from '../src/jobs/tenant-iteration.js';
import {
  parseSlackChannelMapping,
  readSlackExport,
  rollbackSlackImportRun,
  runSlackExportImport,
  SlackImportBlockedError,
} from '../src/services/slack-export-import.service.js';

// Scoped queries log at debug level; keep stdout for the report.
logger.level = process.env.IMPORT_LOG_LEVEL || 'warn';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const organizationId = option('--organization-id') || process.env.IMPORT_ORGANIZATION_ID;
const inputDir = option('--input-dir') || process.env.SLACK_EXPORT_DIR;
const mappingFile = option('--mapping-file');
const summaryFile = option('--summary-file');
const rollbackRunId = option('--rollback');
const channel = option('--channel');
const apply = process.argv.includes('--apply');
const explicitDryRun = process.argv.includes('--dry-run');

const usage = 'Usage: node scripts/import-slack-export.mjs --organization-id <id> (--input-dir <export> --mapping-file <mapping.json> [--channel <name|id>] [--dry-run|--apply] | --rollback <runId>) [--summary-file <report.json>]';
const modes = [apply, explicitDryRun, Boolean(rollbackRunId)].filter(Boolean).length;
if (!organizationId || modes > 1 || (!rollbackRunId && (!inputDir || !mappingFile)) || (process.argv.includes('--rollback') && !rollbackRunId)
  || (process.argv.includes('--channel') && (!channel || rollbackRunId))) {
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
    const report = await runTenantJob(prisma, organizationId, (db) => rollbackSlackImportRun(db, { organizationId, runId: rollbackRunId }));
    await writeReport(report);
    return;
  }

  const [exportData, mappingJson] = await Promise.all([
    readSlackExport(inputDir),
    fs.readFile(path.resolve(mappingFile), 'utf8').then(JSON.parse),
  ]);
  const mapping = parseSlackChannelMapping(mappingJson);
  try {
    const report = await runTenantJob(prisma, organizationId, (db) => runSlackExportImport(db, { organizationId, exportData, mapping, apply, channel }));
    await writeReport(report);
    if (!apply) console.log('Dry run complete. Review the report, retain a backup, and rerun with --apply only after reconciliation approval.');
  } catch (error) {
    // A blocked live run wrote nothing; show its findings but no report file.
    if (error instanceof SlackImportBlockedError) console.error(JSON.stringify({ errors: error.report.errors }, null, 2));
    throw error;
  }
}

main()
  .catch((error) => { console.error(`Slack import failed: ${error.message}`); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
