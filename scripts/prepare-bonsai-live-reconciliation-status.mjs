#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiLiveReconciliationStatus } from '../src/services/bonsaiLiveReconciliationStatus.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
const keys = {
  taskReview: '--task-review', mappingDecision: '--mapping-decision', taskLinkDecision: '--task-link-decision', taskDispositionDecision: '--task-disposition-decision', ownerDecision: '--owner-decision',
  nativeProjectReview: '--native-project-review', projectLinkDecision: '--project-link-decision',
  activeProjectTriage: '--active-project-triage', financialReview: '--financial-review',
};
const paths = Object.fromEntries(Object.entries(keys).map(([key, flag]) => [key, option(flag)]));
const outputPath = option('--output');
const preparedAt = option('--prepared-at');
if (Object.values(paths).some(value => !value) || !outputPath || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:bonsai-live-reconciliation-status -- --task-review <json> --mapping-decision <json> --task-link-decision <json> --task-disposition-decision <json> --owner-decision <json> --native-project-review <json> --project-link-decision <json> --active-project-triage <json> --financial-review <json> --prepared-at <ISO> --output <new-status.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const status = prepareBonsaiLiveReconciliationStatus({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [`${key}Sha256`, value.sha256])),
      preparedAt,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared aligned reconciliation status with ${status.findings.length} pending gate finding(s) and no mutations.\n`);
  } catch {
    process.stderr.write('Bonsai live reconciliation status preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
