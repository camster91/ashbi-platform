import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepareNotionBonsaiNativeProjectLinkReviewBrief,
  verifyNotionBonsaiNativeProjectLinkReviewBrief,
} from '../../services/notionBonsaiNativeProjectLinkReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const MAPPING_HASH = 'b'.repeat(64);
const TASK_REVIEW_HASH = 'c'.repeat(64);

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
      notionSnapshotSha256: 'd'.repeat(64),
      bonsaiProjectSnapshotSha256: 'e'.repeat(64),
      taskReviewSha256: TASK_REVIEW_HASH,
    },
  };
}

function mappingDecision() {
  return {
    format: 'ashbi-notion-bonsai-mapping-decision',
    version: 2,
    preparedAt: '2026-08-28T01:25:00.000Z',
    candidates: [{
      candidateId: 'mapping:project-alias:Task source=>Task target',
      notionProject: 'Task source',
      bonsaiProject: 'Task target',
      decision: 'APPROVED',
    }],
    sourceEvidence: { reviewSha256: TASK_REVIEW_HASH },
  };
}

function brief() {
  return prepareNotionBonsaiNativeProjectLinkReviewBrief({
    review: review(),
    reviewSha256: REVIEW_HASH,
    mappingDecision: mappingDecision(),
    mappingDecisionSha256: MAPPING_HASH,
    preparedAt: '2026-08-28T01:30:00.000Z',
  });
}

test('recommends only unique exact and approved task-backed identities', () => {
  const record = brief();
  assert.equal(record.complete, false);
  assert.deepEqual(record.summary, {
    total: 3,
    approvalReady: 2,
    manualReview: 1,
    byTier: {
      EXACT_TITLE: { total: 1, approvalReady: 1, manualReview: 0 },
      TASK_EVIDENCED: { total: 1, approvalReady: 1, manualReview: 0 },
      SUGGESTED: { total: 1, approvalReady: 0, manualReview: 1 },
    },
  });
  assert.equal(record.candidates[0].reasonCode, 'UNIQUE_EXACT_TITLE_AND_LIFECYCLE');
  assert.equal(record.candidates[1].supportingDecisionCandidateId, 'mapping:project-alias:Task source=>Task target');
  assert.equal(record.candidates[2].recommendedDecision, null);
  assert.equal(record.safeguards.projectLinkDecisionsRecorded, false);
});

test('keeps task-backed identity manual when approved mapping evidence is absent', () => {
  const mapping = mappingDecision();
  mapping.candidates[0].decision = 'PENDING';
  const record = prepareNotionBonsaiNativeProjectLinkReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, mappingDecision: mapping,
    mappingDecisionSha256: MAPPING_HASH, preparedAt: '2026-08-28T01:30:00.000Z',
  });
  assert.equal(record.summary.approvalReady, 1);
  assert.equal(record.candidates[1].reasonCode, 'INSUFFICIENT_APPROVED_IDENTITY_EVIDENCE');
});

test('accepts an approved evidence-backed near-title mapping without pretending it is exact', () => {
  const sourceReview = review();
  sourceReview.taskEvidencedProjectCandidates[0].evidence = 'NEAR_TITLE_SHARED_TASK';
  sourceReview.taskEvidencedProjectCandidates[0].exactSharedTaskCount = 0;
  const record = prepareNotionBonsaiNativeProjectLinkReviewBrief({
    review: sourceReview, reviewSha256: REVIEW_HASH, mappingDecision: mappingDecision(),
    mappingDecisionSha256: MAPPING_HASH, preparedAt: '2026-08-28T01:30:00.000Z',
  });
  assert.equal(record.candidates[1].recommendation, 'APPROVAL_READY');
  assert.equal(record.candidates[1].sourceEvidence, 'NEAR_TITLE_SHARED_TASK');
});

test('rejects mixed task-review generations and detects changed recommendations', () => {
  const mapping = mappingDecision();
  mapping.sourceEvidence.reviewSha256 = 'f'.repeat(64);
  assert.throws(() => prepareNotionBonsaiNativeProjectLinkReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, mappingDecision: mapping,
    mappingDecisionSha256: MAPPING_HASH, preparedAt: '2026-08-28T01:30:00.000Z',
  }), /share one task-review generation/);

  const altered = brief();
  altered.candidates[2].recommendedDecision = 'APPROVED';
  const result = verifyNotionBonsaiNativeProjectLinkReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, mappingDecision: mappingDecision(),
    mappingDecisionSha256: MAPPING_HASH, record: altered,
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('REVIEW_BRIEF_MISMATCH'));
});

test('CLI creates an owner-only brief, verifies it, and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'native-project-link-review-brief-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const mappingPath = path.join(temp, 'mapping.json');
    const outputPath = path.join(temp, 'brief.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    fs.writeFileSync(mappingPath, JSON.stringify(mappingDecision()));
    const prepareArgs = [
      'scripts/prepare-notion-bonsai-native-project-link-review-brief.mjs',
      '--review', reviewPath,
      '--mapping-decision', mappingPath,
      '--prepared-at', '2026-08-28T01:30:00.000Z',
      '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, prepareArgs, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    if (process.platform !== 'win32') assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(spawnSync(process.execPath, prepareArgs, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-native-project-link-review-brief.mjs',
      reviewPath, mappingPath, outputPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
