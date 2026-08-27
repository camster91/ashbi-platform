#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { evaluateBonsaiCutoverReadiness } from '../src/services/bonsai-cutover-readiness.service.js';
import { evaluateUnifiedLaunchReadiness } from '../src/services/unifiedLaunchReadiness.service.js';
import { resolveContainedEvidenceFile } from '../src/services/evidenceManifest.service.js';

const index = process.argv.indexOf('--manifest');
const manifestPath = index >= 0 ? process.argv[index + 1] : null;
let report;
try {
  if (!manifestPath) throw new Error('manifest required');
  const resolvedManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(resolvedManifest);
  const manifest = JSON.parse(fs.readFileSync(resolvedManifest, 'utf8'));
  const nestedArtifact = manifest.artifacts?.find(item => item?.id === 'bonsai-cutover-manifest');
  const nestedPath = resolveContainedEvidenceFile(
    manifestDirectory,
    nestedArtifact?.path,
    'bonsai-cutover-manifest',
  );
  let bonsaiCutoverReport = { ready: false, checks: [] };
  const nestedManifest = JSON.parse(fs.readFileSync(nestedPath, 'utf8'));
  bonsaiCutoverReport = evaluateBonsaiCutoverReadiness({
    manifest: nestedManifest,
    manifestDirectory: path.dirname(nestedPath),
  });
  report = evaluateUnifiedLaunchReadiness({ manifest, manifestDirectory, bonsaiCutoverReport });
} catch {
  report = {
    ready: false,
    checks: [{ id: 'manifest-readable', ok: false, message: 'Provide one readable contained unified launch manifest.' }],
  };
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ready ? 0 : 1;
