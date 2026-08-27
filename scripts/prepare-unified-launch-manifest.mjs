#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  buildUnifiedLaunchManifest,
  resolveNewUnifiedManifestOutput,
} from '../src/services/unifiedLaunchManifest.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const evidenceDirectory = option('--evidence-dir');
const evidenceCompletedAt = option('--evidence-completed-at');
const outputPath = option('--output');

if (!evidenceDirectory || !evidenceCompletedAt || !outputPath) {
  console.error('Usage: npm run prepare:unified-launch-manifest -- --evidence-dir <owner-evidence-directory> --evidence-completed-at <ISO> --output <new-manifest-inside-evidence-directory>');
  process.exitCode = 2;
} else {
  let descriptor;
  let output;
  try {
    output = resolveNewUnifiedManifestOutput(evidenceDirectory, outputPath);
    const manifest = buildUnifiedLaunchManifest({ evidenceDirectory, evidenceCompletedAt });
    descriptor = fs.openSync(output, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.chmodSync(output, 0o600);
    console.log(`Unified launch manifest prepared with ${manifest.artifacts.length} checksum-bound artifacts.`);
  } catch (error) {
    if (descriptor !== undefined && output) {
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.rmSync(output, { force: true });
    }
    console.error(`Manifest preparation failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}
