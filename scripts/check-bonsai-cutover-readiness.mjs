#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateBonsaiCutoverReadiness } from '../src/services/bonsai-cutover-readiness.service.js';

const manifestIndex = process.argv.indexOf('--manifest');
const manifestPath = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : null;

let report;
try {
  if (!manifestPath) throw new Error('manifest required');
  const resolvedManifest = path.resolve(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
  report = evaluateBonsaiCutoverReadiness({
    manifest,
    manifestDirectory: path.dirname(resolvedManifest),
  });
} catch {
  report = {
    ready: false,
    checks: [{ id: 'manifest-readable', ok: false, message: 'Provide one readable cutover manifest.' }],
  };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
