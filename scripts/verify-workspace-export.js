#!/usr/bin/env node

/**
 * Verify an Ashbi workspace export without connecting to the database.
 * Usage: node scripts/verify-workspace-export.js --input <workspace-export.json>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { verifyWorkspaceExport } from '../src/services/workspace-export-integrity.service.js';

const index = process.argv.indexOf('--input');
const input = index >= 0 ? process.argv[index + 1] : null;
if (!input) {
  console.error('Usage: node scripts/verify-workspace-export.js --input <workspace-export.json>');
  process.exit(2);
}

async function main() {
  const target = path.resolve(input);
  const payload = JSON.parse(await fs.readFile(target, 'utf8'));
  const result = verifyWorkspaceExport(payload);
  console.log(JSON.stringify({ input: target, ...result }, null, 2));
  if (!result.valid) process.exitCode = 1;
}

main().catch((error) => { console.error(`Workspace export verification failed: ${error.message}`); process.exitCode = 1; });
