#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { verifyBonsaiActiveProjectDispositionDecision } from '../src/services/bonsaiActiveProjectDispositionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const flags = {
  triage: '--active-project-triage', financialReview: '--financial-review', nativeProjectReview: '--native-project-review',
  projectLinkDecision: '--project-link-decision', projectDispositionDecision: '--project-disposition-decision',
};
const paths = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, option(flag)]));
const recordPath = option('--active-project-disposition-decision');
if (Object.values(paths).some(value => !value) || !recordPath) {
  process.stderr.write('Usage: npm run verify:bonsai-active-project-disposition-decision -- --active-project-triage <triage.json> --financial-review <financial.json> --native-project-review <review.json> --project-link-decision <link.json> --project-disposition-decision <disposition.json> --active-project-disposition-decision <decision.json>\n');
  process.exitCode = 2;
} else {
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const result = verifyBonsaiActiveProjectDispositionDecision({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      triageSha256: artifacts.triage.sha256, financialReviewSha256: artifacts.financialReview.sha256,
      nativeProjectReviewSha256: artifacts.nativeProjectReview.sha256,
      projectLinkDecisionSha256: artifacts.projectLinkDecision.sha256,
      projectDispositionDecisionSha256: artifacts.projectDispositionDecision.sha256,
      record: JSON.parse(fs.readFileSync(path.resolve(recordPath), 'utf8')),
    });
    process.stdout.write(result.valid
      ? `Active-project disposition record is valid with ${result.pending} pending outcome(s).\n`
      : `Active-project disposition record is invalid with ${result.findings.length} finding(s).\n`);
    process.exitCode = result.valid ? 0 : 1;
  } catch {
    process.stderr.write('Bonsai active-project disposition verification failed.\n');
    process.exitCode = 2;
  }
}
