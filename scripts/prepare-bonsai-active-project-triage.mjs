#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareBonsaiActiveProjectTriage } from '../src/services/bonsaiActiveProjectTriage.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

const projectPath = option('--bonsai-projects');
const taskPath = option('--bonsai-tasks');
const groupPath = option('--project-groups');
const reviewPath = option('--native-project-review');
const preparedAt = option('--prepared-at');
const outputPath = option('--output');

if (!projectPath || !taskPath || !groupPath || !reviewPath || !preparedAt || !outputPath) {
  process.stderr.write('Usage: npm run prepare:bonsai-active-project-triage -- --bonsai-projects <projects.json> --bonsai-tasks <tasks.json> --project-groups <groups.json> --native-project-review <review.json> --prepared-at <ISO> --output <new-triage.json>\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    output = fs.openSync(path.resolve(outputPath), 'wx', 0o600);
    const projectBytes = fs.readFileSync(path.resolve(projectPath));
    const taskBytes = fs.readFileSync(path.resolve(taskPath));
    const groupBytes = fs.readFileSync(path.resolve(groupPath));
    const reviewBytes = fs.readFileSync(path.resolve(reviewPath));
    const triage = prepareBonsaiActiveProjectTriage({
      bonsaiProjectSnapshot: JSON.parse(projectBytes.toString('utf8')),
      bonsaiTaskSnapshot: JSON.parse(taskBytes.toString('utf8')),
      projectGroupSnapshot: JSON.parse(groupBytes.toString('utf8')),
      nativeProjectReview: JSON.parse(reviewBytes.toString('utf8')),
      bonsaiProjectSnapshotSha256: digest(projectBytes),
      bonsaiTaskSnapshotSha256: digest(taskBytes),
      projectGroupSnapshotSha256: digest(groupBytes),
      nativeProjectReviewSha256: digest(reviewBytes),
      preparedAt,
    });
    fs.writeFileSync(output, `${JSON.stringify(triage, null, 2)}\n`, 'utf8');
    process.stdout.write(`Prepared ${triage.summary.activeProjects} active project triage record(s) without changing Bonsai.\n`);
  } catch {
    if (output !== undefined) {
      fs.ftruncateSync(output, 0);
      fs.writeFileSync(output, `${JSON.stringify({ format: 'ashbi-bonsai-active-project-triage', version: 1, complete: false, reasonCode: 'TRIAGE_PREPARATION_FAILED' }, null, 2)}\n`, 'utf8');
    }
    process.stderr.write('Bonsai active project triage preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
