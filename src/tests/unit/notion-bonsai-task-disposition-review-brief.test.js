import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiTaskLinkDecision } from '../../services/notionBonsaiTaskLinkDecision.service.js';
import { prepareNotionBonsaiTaskDispositionDecision } from '../../services/notionBonsaiTaskDispositionDecision.service.js';
import {
  prepareNotionBonsaiTaskDispositionReviewBrief,
  verifyNotionBonsaiTaskDispositionReviewBrief,
} from '../../services/notionBonsaiTaskDispositionReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'e'.repeat(64);
const DECISION_HASH = 'b'.repeat(64);
function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactTaskLinks: [{
      notionSourceId: 'https://notion.so/shared', bonsaiSourceId: 'b-shared', taskTitle: 'Shared task',
      notionProject: 'Shared project', bonsaiProject: 'Shared project', projectTitleMatch: true, lifecycleMatch: true,
    }],
    nearTitleCandidates: [],
    notionOnly: [{ notionSourceId: 'https://notion.so/n1', title: 'Notion task', project: 'Notion project', status: 'Doing' }],
    bonsaiOnly: [{ bonsaiSourceId: 'b1', title: 'Bonsai task', project: 'Bonsai project', lifecycleState: 'active', owner: 'Cameron Ashley' }],
    bonsaiSourceReview: [
      { bonsaiSourceId: 'b2', title: 'Projectless', project: '', lifecycleState: 'active', owner: 'Bianca Bien-Aime Ashley', fields: ['project_id'] },
      { bonsaiSourceId: 'b3', title: '', project: 'Retainer', lifecycleState: 'complete', owner: '', fields: ['title'] },
    ],
    sourceEvidence: { notionSnapshotSha256: 'c'.repeat(64), bonsaiSnapshotSha256: 'd'.repeat(64) },
  };
}
function taskLink(source = review(), approved = true, reviewHash = REVIEW_HASH) {
  const pending = prepareNotionBonsaiTaskLinkDecision({
    review: source, reviewSha256: reviewHash, preparedAt: '2026-08-28T01:02:00.000Z',
  });
  return approved ? prepareNotionBonsaiTaskLinkDecision({
    review: source, reviewSha256: reviewHash, preparedAt: '2026-08-28T01:03:00.000Z',
    decisions: [{ candidateId: pending.candidates[0].candidateId, decision: 'APPROVED' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:02:30.000Z', reference: 'task-link-review',
  }) : pending;
}
function decision(source = review(), link = taskLink(source), reviewHash = REVIEW_HASH, linkHash = LINK_HASH) {
  return prepareNotionBonsaiTaskDispositionDecision({
    review: source, reviewSha256: reviewHash, taskLinkDecision: link,
    taskLinkDecisionSha256: linkHash, preparedAt: '2026-08-28T01:05:00.000Z',
  });
}
function brief(source = review(), link = taskLink(source), disposition = decision(source, link)) {
  return prepareNotionBonsaiTaskDispositionReviewBrief({
    review: source, reviewSha256: REVIEW_HASH, taskLinkDecision: link, taskLinkDecisionSha256: LINK_HASH,
    decision: disposition, decisionSha256: DECISION_HASH, preparedAt: '2026-08-28T01:10:00.000Z',
  });
}

test('recommends exact resolution for linked sources and migration or repair for every other source', () => {
  const record = brief();
  assert.equal(record.complete, true);
  assert.deepEqual(record.summary, {
    total: 6, approvalReady: 6, blocked: 0, manualReview: 0,
    byRecommendedDisposition: { RESOLVED_BY_APPROVED_LINK: 2, MIGRATE_TO_HUB: 2, REPAIR_SOURCE_AND_RECAPTURE: 2 },
    bySourceKind: {
      NOTION_TASK: { total: 2, approvalReady: 2, blocked: 0, manualReview: 0 },
      BONSAI_TASK: { total: 2, approvalReady: 2, blocked: 0, manualReview: 0 },
      BONSAI_SOURCE_REVIEW: { total: 2, approvalReady: 2, blocked: 0, manualReview: 0 },
    },
  });
  assert.equal(record.candidates.filter(item => item.recommendedDisposition === 'RESOLVED_BY_APPROVED_LINK').length, 2);
  assert.equal(record.safeguards.taskLinksApplied, false);
  assert.equal(record.safeguards.migrationApplied, false);
});

test('blocks both linked source records while their identity decision is pending', () => {
  const source = review();
  const link = taskLink(source, false);
  const disposition = decision(source, link);
  const record = brief(source, link, disposition);
  assert.equal(record.summary.blocked, 2);
  assert.equal(record.summary.approvalReady, 4);
  assert.equal(record.complete, false);
  assert.equal(record.candidates.filter(item => item.reasonCode === 'TASK_IDENTITY_DECISION_PENDING').length, 2);
});

test('keeps unexpected incomplete source structure in manual review', () => {
  const source = review();
  source.notionOnly[0].project = '';
  const link = taskLink(source);
  const disposition = decision(source, link);
  const record = brief(source, link, disposition);
  const candidate = record.candidates.find(item => item.notionSourceId === 'https://notion.so/n1');
  assert.equal(candidate.recommendation, 'MANUAL_REVIEW');
  assert.equal(record.complete, false);
});

test('rejects a decided packet and detects tampered recommendations', () => {
  const source = review();
  const link = taskLink(source);
  const chosen = decision(source, link);
  chosen.candidates[0].disposition = 'MIGRATE_TO_HUB';
  chosen.candidates[0].rationale = 'Changed';
  chosen.candidates[0].reference = 'test';
  assert.throws(() => brief(source, link, chosen), /fully pending/);

  const disposition = decision(source, link);
  const altered = brief(source, link, disposition);
  altered.candidates[0].recommendedDisposition = 'RETAIN_BONSAI_SOURCE';
  const result = verifyNotionBonsaiTaskDispositionReviewBrief({
    review: source, reviewSha256: REVIEW_HASH, taskLinkDecision: link, taskLinkDecisionSha256: LINK_HASH,
    decision: disposition, decisionSha256: DECISION_HASH, record: altered,
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('REVIEW_BRIEF_MISMATCH'));
});

test('CLI creates and verifies an owner-only all-source brief', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-disposition-review-brief-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const linkPath = path.join(temp, 'link.json');
    const decisionPath = path.join(temp, 'decision.json');
    const outputPath = path.join(temp, 'brief.json');
    const reviewBytes = Buffer.from(JSON.stringify(review()));
    const reviewHash = crypto.createHash('sha256').update(reviewBytes).digest('hex');
    const link = taskLink(review(), true, reviewHash);
    const linkBytes = Buffer.from(JSON.stringify(link));
    const linkHash = crypto.createHash('sha256').update(linkBytes).digest('hex');
    fs.writeFileSync(reviewPath, reviewBytes);
    fs.writeFileSync(linkPath, linkBytes);
    fs.writeFileSync(decisionPath, JSON.stringify(decision(review(), link, reviewHash, linkHash)));
    const args = [
      'scripts/prepare-notion-bonsai-task-disposition-review-brief.mjs', '--review', reviewPath,
      '--task-link-decision', linkPath, '--task-disposition-decision', decisionPath,
      '--prepared-at', '2026-08-28T01:10:00.000Z', '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-task-disposition-review-brief.mjs', reviewPath, linkPath, decisionPath, outputPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
