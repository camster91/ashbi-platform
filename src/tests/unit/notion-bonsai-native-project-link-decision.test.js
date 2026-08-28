import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepareNotionBonsaiNativeProjectLinkDecision,
  verifyNotionBonsaiNativeProjectLinkDecision,
} from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';

const HASH = 'a'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-native-project-review',
    version: 1,
    preparedAt: '2026-08-28T01:19:43.807Z',
    exactProjectLinks: [{
      notionSourceId: 'https://app.notion.com/exact1', notionProject: 'Exact', notionStatus: 'Active',
      bonsaiProjectId: 101, bonsaiProject: 'Exact', bonsaiStatus: 'active',
      evidence: 'EXACT_UNIQUE_PROJECT_TITLE', lifecycleMatch: true,
    }],
    taskEvidencedProjectCandidates: [{
      notionSourceId: 'https://app.notion.com/task1', notionProject: 'Task source', notionStatus: 'Waiting',
      bonsaiProjectId: 102, bonsaiProject: 'Task target', bonsaiStatus: 'active',
      evidence: 'EXACT_SHARED_TASKS', lifecycleMatch: true, exactSharedTaskCount: 2,
      taskEvidence: [{ notionSourceId: 'n-task', bonsaiSourceId: 'b-task', taskTitle: 'Shared' }],
    }],
    possibleTitlePairs: [{
      notionSourceId: 'https://app.notion.com/suggestion1', notionProject: 'Suggested', notionStatus: 'Active',
      bonsaiProjectId: 103, bonsaiProject: 'Suggested Website', bonsaiStatus: 'active',
      evidence: 'PROJECT_TITLE_SIMILARITY_ONLY', reviewScore: 0.75,
      titleTokenDiceSimilarity: 0.75, companyTokenDiceSimilarity: 0.5, candidateRank: 1,
    }],
    sourceEvidence: {
      notionSnapshotSha256: 'b'.repeat(64),
      bonsaiProjectSnapshotSha256: 'c'.repeat(64),
      taskReviewSha256: 'd'.repeat(64),
    },
  };
}

function pending() {
  return prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:30:00Z',
  });
}

test('prepares tiered pending project-link decisions with narrow safeguards', () => {
  const record = pending();
  assert.equal(record.complete, false);
  assert.deepEqual(record.summary.byTier.EXACT_TITLE, { total: 1, approved: 0, rejected: 0, pending: 1 });
  assert.deepEqual(record.summary.byTier.TASK_EVIDENCED, { total: 1, approved: 0, rejected: 0, pending: 1 });
  assert.deepEqual(record.summary.byTier.SUGGESTED, { total: 1, approved: 0, rejected: 0, pending: 1 });
  assert.equal(record.candidates[2].risk, 'HIGH');
  assert.equal(record.safeguards.projectLinksApplied, false);
  assert.equal(record.safeguards.invoicesPaymentsContractsOrTimeAuthorized, false);
  assert.equal(verifyNotionBonsaiNativeProjectLinkDecision({ review: review(), reviewSha256: HASH, record }).valid, true);
});

test('records only explicitly identified decisions and leaves the rest pending', () => {
  const base = pending();
  const decisions = [
    { candidateId: base.candidates[0].candidateId, decision: 'APPROVED' },
    { candidateId: base.candidates[2].candidateId, decision: 'REJECTED' },
  ];
  const record = prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:35:00Z', decisions,
    approver: 'Cameron', decidedAt: '2026-08-28T01:34:00Z', reference: 'codex-user-decision-001',
  });
  assert.deepEqual(record.summary, {
    total: 3, approved: 1, rejected: 1, pending: 1,
    byTier: {
      EXACT_TITLE: { total: 1, approved: 1, rejected: 0, pending: 0 },
      TASK_EVIDENCED: { total: 1, approved: 0, rejected: 0, pending: 1 },
      SUGGESTED: { total: 1, approved: 0, rejected: 1, pending: 0 },
    },
  });
  assert.equal(record.complete, false);
  assert.equal(verifyNotionBonsaiNativeProjectLinkDecision({ review: review(), reviewSha256: HASH, record }).valid, true);
});

test('rejects unknown, duplicate, and blanket-style malformed decision input', () => {
  const base = pending();
  assert.throws(() => prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:35:00Z',
    decisions: [{ candidateId: 'unknown', decision: 'APPROVED' }],
  }), /Unknown project-link candidate/);
  assert.throws(() => prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:35:00Z',
    decisions: [
      { candidateId: base.candidates[0].candidateId, decision: 'APPROVED' },
      { candidateId: base.candidates[0].candidateId, decision: 'REJECTED' },
    ],
  }), /Duplicate project-link decision/);
});

test('verifier rejects changed identity, review checksum, or authorization safeguards', () => {
  const altered = pending();
  altered.candidates[0].bonsaiProject = 'Different';
  assert.ok(verifyNotionBonsaiNativeProjectLinkDecision({ review: review(), reviewSha256: HASH, record: altered }).findings.includes('CANDIDATE_SET_MISMATCH'));
  assert.ok(verifyNotionBonsaiNativeProjectLinkDecision({ review: review(), reviewSha256: 'e'.repeat(64), record: pending() }).findings.includes('SOURCE_EVIDENCE_MISMATCH'));
  const unsafe = pending();
  unsafe.safeguards.lifecycleChangesAuthorized = true;
  assert.ok(verifyNotionBonsaiNativeProjectLinkDecision({ review: review(), reviewSha256: HASH, record: unsafe }).findings.includes('SAFEGUARD_MISMATCH'));
});

test('CLI creates an owner-only pending file, refuses overwrite, and requires confirmation for decisions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-project-link-decision-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'decision.json');
    const decisionsPath = path.join(temp, 'decisions.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    fs.writeFileSync(decisionsPath, JSON.stringify({ decisions: [{ candidateId: pending().candidates[0].candidateId, decision: 'APPROVED' }] }));
    const base = ['scripts/prepare-notion-bonsai-native-project-link-decision.mjs', '--review', reviewPath, '--prepared-at', '2026-08-28T01:30:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, base, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 3);
    assert.equal(spawnSync(process.execPath, base, { encoding: 'utf8' }).status, 2);
    const unconfirmed = spawnSync(process.execPath, [...base.slice(0, -1), path.join(temp, 'approved.json'), '--decisions', decisionsPath], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
