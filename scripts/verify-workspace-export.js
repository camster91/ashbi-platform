#!/usr/bin/env node

/**
 * Verify an Ashbi workspace export without connecting to the database.
 * Usage:
 *   node scripts/verify-workspace-export.js --input-dir <export-directory> [--manifest-sha256 <sha256>]   (offboarding export)
 *   node scripts/verify-workspace-export.js --input <workspace-export.json>  (legacy v2 snapshot)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyWorkspaceExport } from '../src/services/workspace-export-integrity.service.js';
import { verifyWorkspaceExportDirectory } from '../src/services/workspace-export.service.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const input = option('--input');
const inputDir = option('--input-dir');
const expectedManifestSha256 = option('--manifest-sha256');
if (!input === !inputDir) {
  console.error('Usage: node scripts/verify-workspace-export.js --input-dir <export-directory> [--manifest-sha256 <sha256>] | --input <workspace-export.json>');
  process.exit(2);
}

async function main() {
  if (inputDir) {
    const target = path.resolve(inputDir);
    const result = await verifyWorkspaceExportDirectory(target, { expectedManifestSha256 });
    console.log(JSON.stringify({ inputDir: target, ...result }, null, 2));
    if (!result.valid) process.exitCode = 1;
    return;
  }
  const target = path.resolve(input);
  const payload = JSON.parse(await fs.readFile(target, 'utf8'));
  const result = verifyWorkspaceExport(payload);
  console.log(JSON.stringify({ input: target, ...result }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

main().catch((error) => { console.error(`Workspace export verification failed: ${error.message}`); process.exitCode = 1; });
