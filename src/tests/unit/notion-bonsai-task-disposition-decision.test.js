import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiTaskLinkDecision } from '../../services/notionBonsaiTaskLinkDecision.service.js';
import {
  prepareNotionBonsaiTaskDispositionDecision,
  verifyNotionBonsaiTaskDispositionDecision,
} from '../../services/notionBonsaiTaskDispositionDecision.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'd'.repeat(64);
function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactTaskLinks: [{
      notionSourceId: 'https://app.notion.com/shared', bonsaiSourceId: 'bonsai-shared', taskTitle: 'Shared task',
      notionProject: 'Shared project', bonsaiProject: 'Shared project', projectTitleMatch: true, lifecycleMatch: true,
    }],
    nearTitleCandidates: [],
    notionOnly: [{ notionSourceId: 'https://app.notion.com/notion1', title: 'Notion task', project: 'Project A', status: 'To do' }],
    bonsaiOnly: [{ bonsaiSourceId: 'bonsai-1', title: 'Bonsai task', project: 'Project B', lifecycleState: 'active', owner: 'Cameron' }],
    bonsaiSourceReview: [{ bonsaiSourceId: 'bonsai-2', title: '', project: 'Project C', lifecycleState: 'complete', owner: null, fields: ['title'] }],
    sourceEvidence: { notionSnapshotSha256: 'b'.repeat(64), bonsaiSnapshotSha256: 'c'.repeat(64) },
  };
}
function linkDecision(decision = null, reviewHash = REVIEW_HASH) {
  const source = review();
  const pending = prepareNotionBonsaiTaskLinkDecision({
    review: source, reviewSha256: reviewHash, preparedAt: '2026-08-28T01:02:00.000Z',
  });
  return decision ? prepareNotionBonsaiTaskLinkDecision({
    review: source, reviewSha256: reviewHash, preparedAt: '2026-08-28T01:03:00.000Z',
    decisions: [{ candidateId: pending.candidates[0].candidateId, decision }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:02:30.000Z', reference: 'task-link-review',
  }) : pending;
}
function pending(link = linkDecision(), reviewHash = REVIEW_HASH, linkHash = LINK_HASH) {
  return prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: reviewHash, taskLinkDecision: link,
    taskLinkDecisionSha256: linkHash, preparedAt: '2026-08-28T01:05:00.000Z',
  });
}
function verification(record, link = linkDecision(), reviewHash = REVIEW_HASH, linkHash = LINK_HASH) {
  return verifyNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: reviewHash, taskLinkDecision: link,
    taskLinkDecisionSha256: linkHash, record,
  });
}

test('covers every linked, source-only, and malformed source task', () => {
  const record = pending();
  assert.deepEqual(record.summary, {
    total: 5, pending: 5, decided: 0,
    bySourceKind: { NOTION_TASK: 2, BONSAI_TASK: 2, BONSAI_SOURCE_REVIEW: 1 },
    byDisposition: { PENDING: 5 },
  });
  assert.equal(record.version, 2);
  assert.equal(record.scope, 'ALL_SOURCE_TASK_DISPOSITIONS');
  assert.equal(verification(record).valid, true);
});

test('requires each approved link to resolve both exact source records', () => {
  const link = linkDecision('APPROVED');
  const base = pending(link);
  const linked = base.candidates.filter(candidate => candidate.linkedCandidateIds.length === 1);
  const sourceOnly = base.candidates.find(candidate => candidate.sourceKind === 'NOTION_TASK' && candidate.linkedCandidateIds.length === 0);
  const decisions = [
    ...linked.map(candidate => ({
      candidateId: candidate.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK',
      taskLinkCandidateId: candidate.linkedCandidateIds[0], rationale: 'Approved logical identity', reference: 'task-link-review',
    })),
    { candidateId: sourceOnly.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current source task', reference: 'source-review' },
  ];
  const record = prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, taskLinkDecision: link, taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:06:00.000Z', decisions,
    approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'batch-1',
  });
  assert.equal(record.summary.byDisposition.RESOLVED_BY_APPROVED_LINK, 2);
  assert.equal(record.summary.decided, 3);
  assert.equal(verification(record, link).valid, true);
});

test('blocks linked-source dispositions until identity is decided and permits distinct migration after rejection', () => {
  const linkedPending = pending().candidates.find(candidate => candidate.linkedCandidateIds.length === 1);
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, taskLinkDecision: linkDecision(), taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:06:00.000Z', decisions: [{
      candidateId: linkedPending.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Too early', reference: 'ref',
    }],
  }), /pending identity/);

  const rejected = linkDecision('REJECTED');
  const rejectedBase = pending(rejected);
  const linkedRejected = rejectedBase.candidates.find(candidate => candidate.linkedCandidateIds.length === 1);
  const record = prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, taskLinkDecision: rejected, taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:06:00.000Z', decisions: [{
      candidateId: linkedRejected.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Distinct task', reference: 'rejected-link',
    }], approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'batch-2',
  });
  assert.equal(verification(record, rejected).valid, true);
});

test('rejects cross-source dispositions, duplicate decisions, and unsafe mutation claims', () => {
  const base = pending();
  const notion = base.candidates.find(candidate => candidate.sourceKind === 'NOTION_TASK' && candidate.linkedCandidateIds.length === 0);
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, taskLinkDecision: linkDecision(), taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:06:00.000Z', decisions: [{
      candidateId: notion.candidateId, disposition: 'RETAIN_BONSAI_SOURCE', rationale: 'Wrong', reference: 'ref',
    }],
  }), /not allowed/);
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, taskLinkDecision: linkDecision(), taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:06:00.000Z', decisions: [
      { candidateId: notion.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'One', reference: 'a' },
      { candidateId: notion.candidateId, disposition: 'RETAIN_NOTION_SOURCE', rationale: 'Two', reference: 'b' },
    ],
  }), /Duplicate task disposition/);
  const unsafe = pending();
  unsafe.safeguards.taskLinksApplied = true;
  assert.ok(verification(unsafe).findings.includes('SAFEGUARD_MISMATCH'));
});

test('CLI creates a source-bound pending packet and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-disposition-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const linkPath = path.join(temp, 'link.json');
    const outputPath = path.join(temp, 'decision.json');
    const reviewBytes = Buffer.from(JSON.stringify(review()));
    const reviewHash = crypto.createHash('sha256').update(reviewBytes).digest('hex');
    const link = linkDecision(null, reviewHash);
    fs.writeFileSync(reviewPath, reviewBytes);
    fs.writeFileSync(linkPath, JSON.stringify(link));
    const args = [
      'scripts/prepare-notion-bonsai-task-disposition-decision.mjs', '--review', reviewPath,
      '--task-link-decision', linkPath, '--prepared-at', '2026-08-28T01:06:00.000Z', '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 5);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-task-disposition-decision.mjs', '--review', reviewPath,
      '--task-link-decision', linkPath, '--task-disposition-decision', outputPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
