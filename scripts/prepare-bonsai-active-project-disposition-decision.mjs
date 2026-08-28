#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiActiveProjectDispositionDecision } from '../src/services/bonsaiActiveProjectDispositionDecision.service.js';
function option(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
const flags = {
  triage: '--active-project-triage', financialReview: '--financial-review', nativeProjectReview: '--native-project-review',
  projectLinkDecision: '--project-link-decision', projectDispositionDecision: '--project-disposition-decision',
};
const paths = Object.fromEntries(Object.entries(flags).map(([key, flag]) => [key, option(flag)]));
const decisionsPath = option('--decisions');
const outputPath = option('--output');
const preparedAt = option('--prepared-at');
const confirm = process.argv.includes('--confirm');
const approver = option('--approver');
const decidedAt = option('--decided-at');
const reference = option('--reference');
if (Object.values(paths).some(value => !value) || !outputPath || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:bonsai-active-project-disposition-decision -- --active-project-triage <triage.json> --financial-review <financial.json> --native-project-review <review.json> --project-link-decision <link.json> --project-disposition-decision <disposition.json> --prepared-at <ISO> --output <new-decision.json> [--decisions <json> --approver <name> --decided-at <ISO> --reference <evidence> --confirm]\n');
  process.exitCode = 2;
} else if (decisionsPath && !confirm) {
  process.stderr.write('Recording active-project outcomes requires --confirm.\n');
  process.exitCode = 2;
} else if (!decisionsPath && (confirm || approver || decidedAt || reference)) {
  process.stderr.write('Decision evidence requires an explicit --decisions file.\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const artifacts = Object.fromEntries(Object.entries(paths).map(([key, value]) => {
      const bytes = fs.readFileSync(path.resolve(value));
      return [key, { document: JSON.parse(bytes.toString('utf8')), sha256: digest(bytes) }];
    }));
    const input = decisionsPath ? JSON.parse(fs.readFileSync(path.resolve(decisionsPath), 'utf8')) : { decisions: [] };
    const record = prepareBonsaiActiveProjectDispositionDecision({
      ...Object.fromEntries(Object.entries(artifacts).map(([key, value]) => [key, value.document])),
      triageSha256: artifacts.triage.sha256, financialReviewSha256: artifacts.financialReview.sha256,
      nativeProjectReviewSha256: artifacts.nativeProjectReview.sha256,
      projectLinkDecisionSha256: artifacts.projectLinkDecision.sha256,
      projectDispositionDecisionSha256: artifacts.projectDispositionDecision.sha256,
      preparedAt, decisions: input.decisions, approver, decidedAt, reference,
    });
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    process.stdout.write(`Recorded ${record.summary.decided} and retained ${record.summary.pending} pending active-project outcome(s) without applying them.\n`);
  } catch {
    process.stderr.write('Bonsai active-project disposition preparation failed.\n');
    process.exitCode = 2;
  } finally { if (output !== undefined) fs.closeSync(output); }
}
