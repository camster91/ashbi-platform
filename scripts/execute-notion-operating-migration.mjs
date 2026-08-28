#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import prismaPkg from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { assessMigrationSandboxTarget } from '../src/services/migrationSandboxTarget.service.js';
import { executeNotionOperatingMigrationPlan } from '../src/services/notionOperatingMigrationExecutor.service.js';
import { verifyNotionOperatingMigrationPlan } from '../src/services/notionOperatingMigrationPlan.service.js';

const { PrismaClient } = prismaPkg;
const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
const readArtifact = (filePath) => {
  const bytes = fs.readFileSync(path.resolve(filePath));
  return { value: JSON.parse(bytes.toString('utf8')), sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
};
const writeEvidence = (descriptor, value) => {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.ftruncateSync(descriptor, 0);
  fs.writeSync(descriptor, bytes, 0, bytes.length, 0);
  fs.fsyncSync(descriptor);
};

const paths = {
  notion: option('--notion'), taskReview: option('--task-review'), taskLink: option('--task-link-decision'),
  taskDisposition: option('--task-disposition-decision'), projectReview: option('--native-project-review'),
  projectLink: option('--project-link-decision'), projectDisposition: option('--project-disposition-decision'),
  inventory: option('--destination-inventory'), bindings: option('--project-bindings'), plan: option('--plan'),
  mapping: option('--mapping-decision'), result: option('--result'),
};
const organizationId = option('--organization-id')?.trim();
const confirmed = process.argv.includes('--confirm');
const required = Object.entries(paths).filter(([name]) => name !== 'mapping').filter(([, value]) => !value);

if (required.length || !organizationId || !confirmed) {
  console.error('Usage: npm run execute:notion-operating-migration -- --organization-id <sandbox-id> --notion <snapshot.json> --task-review <review.json> --task-link-decision <decision.json> --task-disposition-decision <decision.json> --native-project-review <review.json> --project-link-decision <decision.json> --project-disposition-decision <decision.json> --destination-inventory <inventory.json> --project-bindings <bindings.json> --plan <ready-plan.json> --result <new-result.json> --confirm [--mapping-decision <decision.json>]');
  process.exitCode = 2;
} else if (!process.env.DATABASE_URL) {
  console.error('Notion operating migration refused: database target is not configured.');
  process.exitCode = 2;
} else {
  let prisma;
  let descriptor;
  let evidence;
  let transactionCommitted = false;
  try {
    const sandbox = assessMigrationSandboxTarget({ environment: process.env, organizationId, requireMutationAuthorization: true });
    if (!sandbox.ready) throw new Error('the selected target is not an approved, backed-up migration sandbox');
    const notion = readArtifact(paths.notion);
    const taskReview = readArtifact(paths.taskReview);
    const taskLink = readArtifact(paths.taskLink);
    const taskDisposition = readArtifact(paths.taskDisposition);
    const projectReview = readArtifact(paths.projectReview);
    const projectLink = readArtifact(paths.projectLink);
    const projectDisposition = readArtifact(paths.projectDisposition);
    const inventory = readArtifact(paths.inventory);
    const bindingsDocument = readArtifact(paths.bindings);
    const mapping = paths.mapping ? readArtifact(paths.mapping) : null;
    const plan = readArtifact(paths.plan);
    const planSources = {
      organizationId,
      notionSnapshot: notion.value, notionSnapshotSha256: notion.sha256,
      taskReview: taskReview.value, taskReviewSha256: taskReview.sha256,
      taskLinkDecision: taskLink.value, taskLinkDecisionSha256: taskLink.sha256,
      taskDispositionDecision: taskDisposition.value, taskDispositionDecisionSha256: taskDisposition.sha256,
      nativeProjectReview: projectReview.value, nativeProjectReviewSha256: projectReview.sha256,
      projectLinkDecision: projectLink.value, projectLinkDecisionSha256: projectLink.sha256,
      projectDispositionDecision: projectDisposition.value, projectDispositionDecisionSha256: projectDisposition.sha256,
      mappingDecision: mapping?.value ?? null, mappingDecisionSha256: mapping?.sha256 ?? null,
      destinationInventory: inventory.value, destinationInventorySha256: inventory.sha256,
      notionProjectBindings: bindingsDocument.value.bindings ?? bindingsDocument.value,
    };
    const verification = verifyNotionOperatingMigrationPlan({ ...planSources, record: plan.value });
    if (!verification.valid || !verification.ready || verification.actions !== plan.value.actions.length) {
      throw new Error('the supplied plan does not exactly recompute as READY from the supplied evidence');
    }
    const executedAt = new Date().toISOString();
    const resultPath = path.resolve(paths.result);
    descriptor = fs.openSync(resultPath, 'wx', 0o600);
    evidence = {
      format: 'ashbi-notion-operating-migration-result', version: 1, status: 'RESERVED', complete: false,
      organizationId, executedAt, planSha256: plan.sha256,
      sandboxTarget: { environmentKind: sandbox.environmentKind, targetFingerprint: sandbox.targetFingerprint },
      authorization: {
        backupReference: process.env.ASHBI_SANDBOX_BACKUP_REFERENCE,
        approvalReference: process.env.ASHBI_SANDBOX_APPROVAL_REFERENCE,
      },
    };
    writeEvidence(descriptor, evidence);
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    const result = await executeNotionOperatingMigrationPlan({
      prisma,
      plan: plan.value,
      destinationInventory: inventory.value,
      organizationId,
      executedAt,
    });
    transactionCommitted = true;
    evidence = { ...evidence, status: 'COMPLETED', complete: true, result };
    writeEvidence(descriptor, evidence);
    fs.chmodSync(resultPath, 0o600);
    console.log(`Notion operating migration completed atomically in the sandbox: ${result.actionsApplied} action(s).`);
  } catch (error) {
    if (descriptor !== undefined && evidence) {
      evidence = {
        ...evidence,
        status: transactionCommitted ? 'COMMITTED_EVIDENCE_WRITE_FAILED' : 'FAILED',
        complete: false,
        failure: transactionCommitted
          ? 'The sandbox transaction committed, but final result evidence could not be completed.'
          : 'The sandbox transaction was refused or rolled back before completion.',
      };
      try { writeEvidence(descriptor, evidence); } catch { /* Preserve the last durable evidence bytes. */ }
    }
    console.error(transactionCommitted
      ? 'Notion operating migration committed, but final result evidence could not be completed; reconcile the sandbox before retrying.'
      : `Notion operating migration refused or rolled back: ${error.message}`);
    process.exitCode = 2;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (prisma) await prisma.$disconnect();
  }
}
