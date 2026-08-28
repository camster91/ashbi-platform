import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import { prepareNotionBonsaiProjectDispositionDecision } from '../../services/notionBonsaiProjectDispositionDecision.service.js';
import {
  prepareBonsaiActiveProjectDispositionDecision,
  verifyBonsaiActiveProjectDispositionDecision,
} from '../../services/bonsaiActiveProjectDispositionDecision.service.js';

const H = {
  review: 'a'.repeat(64), link: 'b'.repeat(64), sourceDisposition: 'c'.repeat(64),
  triage: 'd'.repeat(64), financial: 'e'.repeat(64), project: 'f'.repeat(64), task: '1'.repeat(64),
  group: '2'.repeat(64), invoice: '3'.repeat(64), time: '4'.repeat(64),
};
function review() {
  return {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [{
      notionSourceId: 'https://app.notion.com/notion1', notionProject: 'Project', notionStatus: 'Active',
      bonsaiProjectId: 101, bonsaiProject: 'Project', bonsaiStatus: 'active', evidence: 'EXACT_UNIQUE_PROJECT_TITLE', lifecycleMatch: true,
    }],
    taskEvidencedProjectCandidates: [], possibleTitlePairs: [], unmatchedNotionProjects: [], unmatchedBonsaiProjects: [],
    duplicateBonsaiTitles: [], summary: { notionProjects: 1, bonsaiProjects: 1 },
    sourceEvidence: { notionSnapshotSha256: '5'.repeat(64), bonsaiProjectSnapshotSha256: H.project, taskReviewSha256: '6'.repeat(64) },
  };
}
function graph(linkState = 'PENDING') {
  const initialLink = prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: H.review, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  const projectLinkDecision = linkState === 'PENDING' ? initialLink : prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: H.review, preparedAt: '2026-08-28T01:02:00.000Z',
    decisions: [{ candidateId: initialLink.candidates[0].candidateId, decision: linkState }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30.000Z', reference: 'project-link-review',
  });
  const initialDisposition = prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: H.review, projectLinkDecision, projectLinkDecisionSha256: H.link,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
  let projectDispositionDecision = initialDisposition;
  if (linkState !== 'PENDING') {
    const decisions = initialDisposition.candidates.map(candidate => linkState === 'APPROVED' ? {
      candidateId: candidate.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK', rationale: 'Same project',
      reference: 'project-link-review', projectLinkCandidateId: projectLinkDecision.candidates[0].candidateId,
    } : {
      candidateId: candidate.candidateId,
      disposition: candidate.sourceKind === 'BONSAI_PROJECT' ? 'RETAIN_BONSAI_SOURCE' : 'MIGRATE_TO_HUB',
      rationale: 'Sources remain distinct', reference: 'project-source-review',
    });
    projectDispositionDecision = prepareNotionBonsaiProjectDispositionDecision({
      review: review(), reviewSha256: H.review, projectLinkDecision, projectLinkDecisionSha256: H.link,
      preparedAt: '2026-08-28T01:04:00.000Z', decisions,
      approver: 'Cameron', decidedAt: '2026-08-28T01:03:30.000Z', reference: 'project-disposition-batch',
    });
  }
  return { projectLinkDecision, projectDispositionDecision };
}
function triage(reviewHash = H.review) {
  return {
    format: 'ashbi-bonsai-active-project-triage', version: 1, preparedAt: '2026-08-28T01:05:00.000Z',
    summary: { activeProjects: 1 },
    records: [{
      bonsaiProjectId: 101, project: 'Project', company: 'Client', url: 'https://example.test/project/101',
      projectGroup: { id: 'group-1', name: 'In Progress', state: 'active' },
      taskEvidence: { total: 1, taskSourceIds: ['task-1'] },
      notionEvidence: { notionSourceId: 'https://app.notion.com/notion1' },
      duplicateTitleGroup: false, triageBucket: 'PROVEN_EXACT_LINK_REVIEW',
    }],
    sourceEvidence: {
      bonsaiProjectSnapshotSha256: H.project, bonsaiTaskSnapshotSha256: H.task,
      projectGroupSnapshotSha256: H.group, nativeProjectReviewSha256: reviewHash,
    },
  };
}
function financial(triageHash = H.triage, closureAuthorized = false) {
  return {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, preparedAt: '2026-08-28T01:06:00.000Z',
    summary: { activeProjects: 1 },
    records: [{
      bonsaiProjectId: 101,
      invoiceEvidence: { invoiceCount: 1, nonPaidInvoiceCount: 1 },
      timeEvidence: { entryCount: 1, unbilledEntryCount: 1 },
      paymentEvidence: { checked: false }, contractEvidence: { checked: false },
      financialAttentionReasons: ['NON_PAID_INVOICE', 'UNBILLED_TIME'], closureAuthorized,
    }],
    sourceEvidence: { activeProjectTriageSha256: triageHash, invoiceSnapshotSha256: H.invoice, timeEntrySnapshotSha256: H.time },
  };
}
function options(linkState = 'PENDING', closureAuthorized = false) {
  return {
    triage: triage(), triageSha256: H.triage, financialReview: financial(H.triage, closureAuthorized), financialReviewSha256: H.financial,
    nativeProjectReview: review(), nativeProjectReviewSha256: H.review,
    ...graph(linkState), projectLinkDecisionSha256: H.link, projectDispositionDecisionSha256: H.sourceDisposition,
    preparedAt: '2026-08-28T01:07:00.000Z',
  };
}

test('prepares one pending active-project outcome per complete triage record', () => {
  const input = options();
  const record = prepareBonsaiActiveProjectDispositionDecision(input);
  assert.deepEqual(record.summary, { total: 1, pending: 1, decided: 0, closureAuthorized: 0, byOutcome: { PENDING: 1 } });
  assert.equal(record.safeguards.projectsClosedOrArchived, false);
  assert.equal(verifyBonsaiActiveProjectDispositionDecision({ ...input, record }).valid, true);
});

test('blocks active outcomes until identity and source disposition decisions are complete', () => {
  const input = options();
  const candidate = prepareBonsaiActiveProjectDispositionDecision(input).candidates[0];
  assert.throws(() => prepareBonsaiActiveProjectDispositionDecision({
    ...input, preparedAt: '2026-08-28T01:08:00.000Z',
    decisions: [{ candidateId: candidate.candidateId, outcome: 'MIGRATE_ACTIVE_TO_HUB', rationale: 'Current', reference: 'row-1' }],
  }), /wait for project identity/);
});

test('records only outcomes compatible with approved upstream project dispositions', () => {
  const migrateInput = options('APPROVED');
  const migrateCandidate = prepareBonsaiActiveProjectDispositionDecision(migrateInput).candidates[0];
  const migrated = prepareBonsaiActiveProjectDispositionDecision({
    ...migrateInput, preparedAt: '2026-08-28T01:08:00.000Z',
    decisions: [{ candidateId: migrateCandidate.candidateId, outcome: 'MIGRATE_ACTIVE_TO_HUB', rationale: 'Current linked work', reference: 'row-1' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:07:30.000Z', reference: 'active-batch-1',
  });
  assert.equal(migrated.complete, true);

  const retainInput = options('REJECTED');
  const retainCandidate = prepareBonsaiActiveProjectDispositionDecision(retainInput).candidates[0];
  assert.throws(() => prepareBonsaiActiveProjectDispositionDecision({
    ...retainInput, preparedAt: '2026-08-28T01:08:00.000Z',
    decisions: [{ candidateId: retainCandidate.candidateId, outcome: 'MIGRATE_ACTIVE_TO_HUB', rationale: 'Conflict', reference: 'row-2' }],
  }), /conflicts/);
  const retained = prepareBonsaiActiveProjectDispositionDecision({
    ...retainInput, preparedAt: '2026-08-28T01:08:00.000Z',
    decisions: [{ candidateId: retainCandidate.candidateId, outcome: 'RETAIN_ACTIVE_IN_BONSAI', rationale: 'Distinct source', reference: 'row-3' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:07:30.000Z', reference: 'active-batch-2',
  });
  assert.equal(retained.summary.decided, 1);
});

test('refuses project closure without complete financial clearance evidence', () => {
  const input = options('APPROVED');
  const candidate = prepareBonsaiActiveProjectDispositionDecision(input).candidates[0];
  assert.throws(() => prepareBonsaiActiveProjectDispositionDecision({
    ...input, preparedAt: '2026-08-28T01:08:00.000Z',
    decisions: [{ candidateId: candidate.candidateId, outcome: 'CLOSE_AFTER_FINANCIAL_CLEARANCE', rationale: 'Close', reference: 'row' }],
  }), /financial clearance/);
});

test('CLI creates a new pending packet, refuses overwrite, and requires confirmation', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'active-project-disposition-'));
  try {
    const write = (name, document) => {
      const file = path.join(temp, `${name}.json`);
      const bytes = Buffer.from(JSON.stringify(document));
      fs.writeFileSync(file, bytes);
      return { file, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
    };
    const native = write('native', review());
    const linkDocument = prepareNotionBonsaiNativeProjectLinkDecision({
      review: review(), reviewSha256: native.hash, preparedAt: '2026-08-28T01:01:00.000Z',
    });
    const link = write('link', linkDocument);
    const sourceDisposition = write('sourceDisposition', prepareNotionBonsaiProjectDispositionDecision({
      review: review(), reviewSha256: native.hash, projectLinkDecision: linkDocument,
      projectLinkDecisionSha256: link.hash, preparedAt: '2026-08-28T01:03:00.000Z',
    }));
    const triageArtifact = write('triage', triage(native.hash));
    const financialArtifact = write('financial', financial(triageArtifact.hash));
    const output = path.join(temp, 'active.json');
    const args = ['scripts/prepare-bonsai-active-project-disposition-decision.mjs',
      '--active-project-triage', triageArtifact.file, '--financial-review', financialArtifact.file,
      '--native-project-review', native.file, '--project-link-decision', link.file,
      '--project-disposition-decision', sourceDisposition.file, '--prepared-at', '2026-08-28T01:07:00.000Z', '--output', output];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).summary.pending, 1);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const decisions = path.join(temp, 'decisions.json');
    fs.writeFileSync(decisions, JSON.stringify({ decisions: [] }));
    const unconfirmed = spawnSync(process.execPath, [...args.slice(0, -1), path.join(temp, 'decided.json'), '--decisions', decisions], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
