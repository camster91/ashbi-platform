#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { prepareNotionOperatingMigrationPlan } from '../src/services/notionOperatingMigrationPlan.service.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
function readArtifact(filePath) {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

const paths = {
  notion: option('--notion'), taskReview: option('--task-review'), taskLink: option('--task-link-decision'),
  taskDisposition: option('--task-disposition-decision'), projectReview: option('--native-project-review'),
  projectLink: option('--project-link-decision'), projectDisposition: option('--project-disposition-decision'),
  inventory: option('--destination-inventory'), bindings: option('--project-bindings'),
  mapping: option('--mapping-decision'), output: option('--output'),
};
const preparedAt = option('--prepared-at');
const required = Object.entries(paths).filter(([name]) => name !== 'mapping').filter(([, value]) => !value);
if (required.length || !preparedAt) {
  process.stderr.write('Usage: npm run prepare:notion-operating-migration-plan -- --notion <snapshot.json> --task-review <review.json> --task-link-decision <decision.json> --task-disposition-decision <decision.json> --native-project-review <review.json> --project-link-decision <decision.json> --project-disposition-decision <decision.json> --destination-inventory <inventory.json> --project-bindings <bindings.json> --prepared-at <ISO> --output <new-plan.json> [--mapping-decision <decision.json>]\n');
  process.exitCode = 2;
} else {
  let output;
  try {
    const notion = readArtifact(paths.notion);
    const taskReview = readArtifact(paths.taskReview);
    const taskLink = readArtifact(paths.taskLink);
    const taskDisposition = readArtifact(paths.taskDisposition);
    const projectReview = readArtifact(paths.projectReview);
    const projectLink = readArtifact(paths.projectLink);
    const projectDisposition = readArtifact(paths.projectDisposition);
    const inventory = readArtifact(paths.inventory).value;
    const bindingsDocument = readArtifact(paths.bindings).value;
    const mapping = paths.mapping ? readArtifact(paths.mapping) : null;
    const plan = prepareNotionOperatingMigrationPlan({
      organizationId: inventory.organizationId,
      notionSnapshot: notion.value, notionSnapshotSha256: notion.sha256,
      taskReview: taskReview.value, taskReviewSha256: taskReview.sha256,
      taskLinkDecision: taskLink.value, taskLinkDecisionSha256: taskLink.sha256,
      taskDispositionDecision: taskDisposition.value, taskDispositionDecisionSha256: taskDisposition.sha256,
      nativeProjectReview: projectReview.value, nativeProjectReviewSha256: projectReview.sha256,
      projectLinkDecision: projectLink.value, projectLinkDecisionSha256: projectLink.sha256,
      projectDispositionDecision: projectDisposition.value, projectDispositionDecisionSha256: projectDisposition.sha256,
      mappingDecision: mapping?.value ?? null, mappingDecisionSha256: mapping?.sha256 ?? null,
      existingSourceRecords: inventory.sourceRecords, destinationClients: inventory.clients,
      destinationProjects: inventory.projects, destinationTasks: inventory.tasks,
      notionProjectBindings: bindingsDocument.bindings ?? bindingsDocument,
      preparedAt,
    });
    output = fs.openSync(path.resolve(paths.output), 'wx', 0o600);
    fs.writeFileSync(output, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');
    process.stdout.write(`${plan.status}: ${plan.summary.actions} planned action(s), ${plan.summary.findings} finding(s); no records changed.\n`);
    if (plan.status !== 'READY') process.exitCode = 2;
  } catch {
    process.stderr.write('Notion operating migration plan preparation failed.\n');
    process.exitCode = 2;
  } finally {
    if (output !== undefined) fs.closeSync(output);
  }
}
