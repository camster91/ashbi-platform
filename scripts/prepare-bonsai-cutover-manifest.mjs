#!/usr/bin/env node
import fs from 'node:fs';
import {
  resolveContainedEvidenceFile,
  resolveNewEvidenceOutput,
} from '../src/services/evidenceManifest.service.js';
import { buildBonsaiCutoverManifest } from '../src/services/bonsaiCutoverManifest.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const evidenceDirectory = option('--evidence-dir');
const draftPath = option('--draft');
const outputPath = option('--output');

if (!evidenceDirectory || !draftPath || !outputPath) {
  console.error('Usage: npm run prepare:bonsai-cutover-manifest -- --evidence-dir <owner-evidence-directory> --draft <relative-draft-path> --output <new-manifest-inside-evidence-directory>');
  process.exitCode = 2;
} else {
  let descriptor;
  let output;
  try {
    const draftFile = resolveContainedEvidenceFile(evidenceDirectory, draftPath, 'bonsai-cutover-draft');
    const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
    const manifest = buildBonsaiCutoverManifest({ evidenceDirectory, draft });
    output = resolveNewEvidenceOutput(evidenceDirectory, outputPath);
    descriptor = fs.openSync(output, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.chmodSync(output, 0o600);
    console.log(`Bonsai cutover manifest prepared with ${manifest.artifacts.length} checksum-bound artifacts.`);
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
