import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiTaskDispositionDecision } from '../../services/notionBonsaiTaskDispositionDecision.service.js';
import {
  prepareNotionBonsaiTaskDispositionReviewBrief,
  verifyNotionBonsaiTaskDispositionReviewBrief,
} from '../../services/notionBonsaiTaskDispositionReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const DECISION_HASH = 'b'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review',
    version: 1,
    preparedAt: '2026-08-28T01:00:00.000Z',
    notionOnly: [{ notionSourceId: 'https://notion.so/n1', title: 'Notion task', project: 'Notion project', status: 'Doing' }],
    bonsaiOnly: [{ bonsaiSourceId: 'b1', title: 'Bonsai task', project: 'Bonsai project', lifecycleState: 'active', owner: 'Cameron Ashley' }],
    bonsaiSourceReview: [
      { bonsaiSourceId: 'b2', title: 'Projectless', project: '', lifecycleState: 'active', owner: 'Bianca Bien-Aime Ashley', fields: ['project_id'] },
      { bonsaiSourceId: 'b3', title: '', project: 'Retainer', lifecycleState: 'complete', owner: '', fields: ['title'] },
    ],
    sourceEvidence: { notionSnapshotSha256: 'c'.repeat(64), bonsaiSnapshotSha256: 'd'.repeat(64) },
  };
}

function decision(sourceReview = review()) {
  return prepareNotionBonsaiTaskDispositionDecision({
    review: sourceReview,
    reviewSha256: REVIEW_HASH,
    preparedAt: '2026-08-28T01:05:00.000Z',
  });
}

function brief() {
  return prepareNotionBonsaiTaskDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, decision: decision(), decisionSha256: DECISION_HASH,
    preparedAt: '2026-08-28T01:10:00.000Z',
  });
}

test('recommends valid source-only migration and malformed Bonsai source repair', () => {
  const record = brief();
  assert.equal(record.complete, true);
  assert.deepEqual(record.summary, {
    total: 4,
    approvalReady: 4,
    manualReview: 0,
    byRecommendedDisposition: { MIGRATE_TO_HUB: 2, REPAIR_SOURCE_AND_RECAPTURE: 2 },
    bySourceKind: {
      NOTION_ONLY: { total: 1, approvalReady: 1, manualReview: 0 },
      BONSAI_ONLY: { total: 1, approvalReady: 1, manualReview: 0 },
      BONSAI_SOURCE_REVIEW: { total: 2, approvalReady: 2, manualReview: 0 },
    },
  });
  assert.equal(record.candidates[0].recommendedDisposition, 'MIGRATE_TO_HUB');
  assert.equal(record.candidates[1].recommendedDisposition, 'REPAIR_SOURCE_AND_RECAPTURE');
  assert.equal(record.candidates[2].recommendedDisposition, 'REPAIR_SOURCE_AND_RECAPTURE');
  assert.equal(record.candidates[3].recommendedDisposition, 'MIGRATE_TO_HUB');
  assert.equal(record.safeguards.taskDispositionDecisionsRecorded, false);
  assert.equal(record.safeguards.migrationApplied, false);
});

test('keeps unexpected incomplete source-only structure in manual review', () => {
  const sourceReview = review();
  sourceReview.notionOnly[0].project = '';
  const record = prepareNotionBonsaiTaskDispositionReviewBrief({
    review: sourceReview, reviewSha256: REVIEW_HASH, decision: decision(sourceReview), decisionSha256: DECISION_HASH,
    preparedAt: '2026-08-28T01:10:00.000Z',
  });
  const candidate = record.candidates.find(item => item.sourceKind === 'NOTION_ONLY');
  assert.equal(record.complete, false);
  assert.equal(candidate.recommendation, 'MANUAL_REVIEW');
  assert.equal(candidate.recommendedDisposition, null);
});

test('rejects a decided or invalid decision packet', () => {
  const chosen = decision();
  chosen.candidates[0].disposition = 'MIGRATE_TO_HUB';
  chosen.candidates[0].rationale = 'Changed';
  chosen.candidates[0].reference = 'test';
  assert.throws(() => prepareNotionBonsaiTaskDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, decision: chosen, decisionSha256: DECISION_HASH,
    preparedAt: '2026-08-28T01:10:00.000Z',
  }), /fully pending/);
});

test('detects tampered recommendations', () => {
  const altered = brief();
  altered.candidates[0].recommendedDisposition = 'RETAIN_BONSAI_ONLY';
  const result = verifyNotionBonsaiTaskDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, decision: decision(), decisionSha256: DECISION_HASH, record: altered,
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('REVIEW_BRIEF_MISMATCH'));
});

test('CLI creates an owner-only brief, verifies it, and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-disposition-review-brief-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const decisionPath = path.join(temp, 'decision.json');
    const outputPath = path.join(temp, 'brief.json');
    const reviewBytes = Buffer.from(JSON.stringify(review()));
    fs.writeFileSync(reviewPath, reviewBytes);
    fs.writeFileSync(decisionPath, JSON.stringify(prepareNotionBonsaiTaskDispositionDecision({
      review: review(),
      reviewSha256: crypto.createHash('sha256').update(reviewBytes).digest('hex'),
      preparedAt: '2026-08-28T01:05:00.000Z',
    })));
    const args = [
      'scripts/prepare-notion-bonsai-task-disposition-review-brief.mjs', '--review', reviewPath,
      '--task-disposition-decision', decisionPath, '--prepared-at', '2026-08-28T01:10:00.000Z', '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    if (process.platform !== 'win32') assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-task-disposition-review-brief.mjs', reviewPath, decisionPath, outputPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
