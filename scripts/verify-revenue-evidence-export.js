#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyRevenueEvidenceExport } from '../src/services/revenueEvidenceExport.service.js';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run verify:revenue-evidence -- <export.json>');
  process.exitCode = 2;
} else {
  try {
    const filename = path.resolve(input);
    const payload = JSON.parse(await readFile(filename, 'utf8'));
    const result = verifyRevenueEvidenceExport(payload);
    console.log(JSON.stringify({ file: filename, ...result }, null, 2));
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: error.message }, null, 2));
    process.exitCode = 2;
  }
}
