import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  prepareBonsaiLiveReconciliationStatus,
  verifyBonsaiLiveReconciliationStatus,
} from '../../services/bonsaiLiveReconciliationStatus.service.js';
import { prepareNotionBonsaiMappingDecision } from '../../services/notionBonsaiMappingDecision.service.js';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import { prepareNotionBonsaiOwnerDecision } from '../../services/notionBonsaiOwnerDecision.service.js';

const HASHES = {
  taskReview: 'a'.repeat(64), mappingDecision: 'b'.repeat(64), ownerDecision: 'c'.repeat(64),
  nativeProjectReview: 'd'.repeat(64), projectLinkDecision: 'e'.repeat(64),
  activeProjectTriage: 'f'.repeat(64), financialReview: '1'.repeat(64),
  notion: '2'.repeat(64), tasks: '3'.repeat(64), projects: '4'.repeat(64),
  groups: '5'.repeat(64), invoices: '6'.repeat(64), time: '7'.repeat(64),
};

function evidence() {
  const taskReview = {
    format: 'ashbi-notion-bonsai-task-review', version: 1, complete: false,
    preparedAt: '2026-08-28T01:00:00.000Z',
    exactTaskLinks: [{
      notionSourceId: 'notion-task-1', bonsaiSourceId: 'bonsai-task-1', taskTitle: 'Shared task',
      notionProject: 'Shared project', bonsaiProject: 'Shared project', bonsaiOwner: 'Cameron Ashley',
      projectTitleMatch: true,
    }],
    projectAliasCandidates: [{
      notionProject: 'Alias source', bonsaiProject: 'Alias target',
      evidence: [{ notionSourceId: 'notion-task-2', bonsaiSourceId: 'bonsai-task-2', taskTitle: 'Alias task' }],
    }],
    nearTitleCandidates: [],
    summary: {
      notionTasks: 3, bonsaiTasks: 4, exactTaskLinks: 1, exactTaskLinksReadyForApproval: 1,
      projectAliasCandidates: 1, nearTitleCandidates: 0, notionOnly: 2, bonsaiOnly: 3,
      bonsaiSourceReview: 1, reviewItems: 7,
    },
    sourceEvidence: { notionSnapshotSha256: HASHES.notion, bonsaiSnapshotSha256: HASHES.tasks },
  };
  const mappingDecision = prepareNotionBonsaiMappingDecision({
    review: taskReview, reviewSha256: HASHES.taskReview, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  const ownerDecision = prepareNotionBonsaiOwnerDecision({
    review: taskReview, reviewSha256: HASHES.taskReview, preparedAt: '2026-08-28T01:02:00.000Z',
  });
  const nativeProjectReview = {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1, complete: false,
    preparedAt: '2026-08-28T01:03:00.000Z',
    exactProjectLinks: [{
      notionSourceId: 'https://app.notion.com/project1', notionProject: 'Project', notionStatus: 'Active',
      bonsaiProjectId: 101, bonsaiProject: 'Project', bonsaiStatus: 'active',
      evidence: 'EXACT_UNIQUE_PROJECT_TITLE', lifecycleMatch: true,
    }],
    taskEvidencedProjectCandidates: [], possibleTitlePairs: [],
    summary: {
      notionProjects: 2, bonsaiProjects: 3, exactProjectLinks: 1, taskEvidencedProjectCandidates: 0,
      lifecycleDifferences: 0, unmatchedNotionProjects: 1, unmatchedBonsaiProjects: 2,
      possibleTitlePairs: 0, duplicateBonsaiTitles: 1, taskEvidenceFindings: 0,
    },
    sourceEvidence: {
      notionSnapshotSha256: HASHES.notion, bonsaiProjectSnapshotSha256: HASHES.projects,
      taskReviewSha256: HASHES.taskReview,
    },
  };
  const projectLinkDecision = prepareNotionBonsaiNativeProjectLinkDecision({
    review: nativeProjectReview, reviewSha256: HASHES.nativeProjectReview,
    preparedAt: '2026-08-28T01:04:00.000Z',
  });
  const activeProjectTriage = {
    format: 'ashbi-bonsai-active-project-triage', version: 1, complete: false,
    preparedAt: '2026-08-28T01:05:00.000Z', summary: { activeProjects: 3 },
    sourceEvidence: {
      bonsaiProjectSnapshotSha256: HASHES.projects, bonsaiTaskSnapshotSha256: HASHES.tasks,
      projectGroupSnapshotSha256: HASHES.groups, nativeProjectReviewSha256: HASHES.nativeProjectReview,
    },
  };
  const financialReview = {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, complete: false,
    preparedAt: '2026-08-28T01:06:00.000Z',
    summary: {
      closureAuthorizedProjects: 0, projectlessTimeEntries: 1,
      projectsWithNonPaidInvoices: 2, projectsWithUnbilledTime: 1,
    },
    sourceEvidence: {
      activeProjectTriageSha256: HASHES.activeProjectTriage,
      invoiceSnapshotSha256: HASHES.invoices, timeEntrySnapshotSha256: HASHES.time,
    },
  };
  return { taskReview, mappingDecision, ownerDecision, nativeProjectReview, projectLinkDecision, activeProjectTriage, financialReview };
}

function options() {
  return {
    ...evidence(),
    taskReviewSha256: HASHES.taskReview,
    mappingDecisionSha256: HASHES.mappingDecision,
    ownerDecisionSha256: HASHES.ownerDecision,
    nativeProjectReviewSha256: HASHES.nativeProjectReview,
    projectLinkDecisionSha256: HASHES.projectLinkDecision,
    activeProjectTriageSha256: HASHES.activeProjectTriage,
    financialReviewSha256: HASHES.financialReview,
    preparedAt: '2026-08-28T01:07:00.000Z',
  };
}

test('prepares one aligned, fail-closed reconciliation status without mutation authority', () => {
  const status = prepareBonsaiLiveReconciliationStatus(options());
  assert.equal(status.sourceGenerationAligned, true);
  assert.equal(status.readyForMigration, false);
  assert.equal(status.readyForBonsaiRetirement, false);
  assert.equal(status.gates.taskIdentity.exactTaskLinksWithoutDecisionRecord, 1);
  assert.equal(status.gates.projectIdentity.decisionsPending, 1);
  assert.equal(status.gates.financialSafety.projectlessTimeEntries, 1);
  assert.ok(status.findings.includes('EXACT_TASK_LINK_DECISION_RECORD_MISSING'));
  assert.equal(status.safeguards.externalWritesPerformed, false);
  assert.equal(status.safeguards.bonsaiRetirementAuthorized, false);
});

test('rejects a mixed-generation Bonsai task chain', () => {
  const input = options();
  input.activeProjectTriage.sourceEvidence.bonsaiTaskSnapshotSha256 = '8'.repeat(64);
  assert.throws(() => prepareBonsaiLiveReconciliationStatus(input), /another evidence generation/);
});

test('verifier rejects any changed gate or source-bound decision', () => {
  const input = options();
  const record = prepareBonsaiLiveReconciliationStatus(input);
  assert.equal(verifyBonsaiLiveReconciliationStatus({ ...input, record }).valid, true);
  record.gates.retirement.explicitFinancialCutoverApproval = true;
  assert.deepEqual(verifyBonsaiLiveReconciliationStatus({ ...input, record }).findings, ['STATUS_RECORD_MISMATCH']);
});

test('CLI creates a new status file and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bonsai-live-status-'));
  try {
    const input = evidence();
    const write = (name, document) => {
      const file = path.join(temp, `${name}.json`);
      const bytes = Buffer.from(JSON.stringify(document));
      fs.writeFileSync(file, bytes);
      return { file, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    };
    const task = write('taskReview', input.taskReview);
    input.mappingDecision = prepareNotionBonsaiMappingDecision({
      review: input.taskReview, reviewSha256: task.hash, preparedAt: '2026-08-28T01:01:00.000Z',
    });
    input.ownerDecision = prepareNotionBonsaiOwnerDecision({
      review: input.taskReview, reviewSha256: task.hash, preparedAt: '2026-08-28T01:02:00.000Z',
    });
    input.nativeProjectReview.sourceEvidence.taskReviewSha256 = task.hash;
    const native = write('nativeProjectReview', input.nativeProjectReview);
    input.projectLinkDecision = prepareNotionBonsaiNativeProjectLinkDecision({
      review: input.nativeProjectReview, reviewSha256: native.hash, preparedAt: '2026-08-28T01:04:00.000Z',
    });
    input.activeProjectTriage.sourceEvidence.nativeProjectReviewSha256 = native.hash;
    const triage = write('activeProjectTriage', input.activeProjectTriage);
    input.financialReview.sourceEvidence.activeProjectTriageSha256 = triage.hash;
    const names = ['taskReview', 'mappingDecision', 'ownerDecision', 'nativeProjectReview', 'projectLinkDecision', 'activeProjectTriage', 'financialReview'];
    const flags = {
      taskReview: '--task-review', mappingDecision: '--mapping-decision', ownerDecision: '--owner-decision',
      nativeProjectReview: '--native-project-review', projectLinkDecision: '--project-link-decision',
      activeProjectTriage: '--active-project-triage', financialReview: '--financial-review',
    };
    const args = ['scripts/prepare-bonsai-live-reconciliation-status.mjs'];
    for (const name of names) {
      const file = path.join(temp, `${name}.json`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(input[name]));
      args.push(flags[name], file);
    }
    const output = path.join(temp, 'status.json');
    args.push('--prepared-at', '2026-08-28T01:07:00.000Z', '--output', output);
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).sourceGenerationAligned, true);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
