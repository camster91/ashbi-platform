#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiLiveReconciliationStatus } from '../src/services/bonsaiLiveReconciliationStatus.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
const keys = {
  taskReview: '--task-review', mappingDecision: '--mapping-decision', taskLinkDecision: '--task-link-decision', ownerDecision: '--owner-decision',
  nativeProjectReview: '--native-project-review', projectLinkDecision: '--project-link-decision',
  activeProjectTriage: '--active-project-triage', financialReview: '--financial-review',
};
const paths = Object.fromEntries(Object.entries(keys).map(([key, flag]) => [key, option(flag)]));
const recordPath = option('--status');
if (Object.values(paths).some(value => !value) || !recordPath) {
  process.stderr.write('Usage: npm run verify:bonsai-live-reconciliation-status -- --task-review <json> --mapping-decision <json> --task-link-decision <json> --owner-decision <json> --native-project-review <json> --project-link-decision <json> --active-project-triage <json> --financial-review <json> --status <json>\n');
  process.exitCode = 2;
} else {
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const result = verifyBonsaiLiveReconciliationStatus({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [`${key}Sha256`, value.sha256])),
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Live reconciliation status is valid; migration ready=${result.readyForMigration}, Bonsai retirement ready=${result.readyForBonsaiRetirement}.\n`
      : `Live reconciliation status is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Bonsai live reconciliation status verification failed.\n');
    process.exitCode = 2;
  }
}
