import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiMappingDecision } from '../../services/notionBonsaiMappingDecision.service.js';
import {
  prepareNotionBonsaiTaskLinkDecision,
  verifyNotionBonsaiTaskLinkDecision,
} from '../../services/notionBonsaiTaskLinkDecision.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const MAPPING_HASH = 'b'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactTaskLinks: [
      {
        notionSourceId: 'https://app.notion.com/direct1', bonsaiSourceId: 'bonsai-direct-1', taskTitle: 'Direct',
        notionProject: 'Direct project', bonsaiProject: 'Direct project', lifecycleMatch: true, projectTitleMatch: true,
      },
      {
        notionSourceId: 'https://app.notion.com/alias1', bonsaiSourceId: 'bonsai-alias-1', taskTitle: 'Alias',
        notionProject: 'Alias source', bonsaiProject: 'Alias target', lifecycleMatch: true, projectTitleMatch: false,
      },
    ],
    projectAliasCandidates: [{
      notionProject: 'Alias source', bonsaiProject: 'Alias target',
      evidence: [{ notionSourceId: 'https://app.notion.com/alias1', bonsaiSourceId: 'bonsai-alias-1', taskTitle: 'Alias' }],
    }],
    nearTitleCandidates: [{
      notionSourceId: 'https://app.notion.com/near1', bonsaiSourceId: 'bonsai-near-1',
      notionTitle: 'Near title one', bonsaiTitle: 'Near title', tokenDiceSimilarity: 0.9,
      notionProject: 'Near source', bonsaiProject: 'Near target', lifecycleMatch: true,
    }],
    sourceEvidence: { notionSnapshotSha256: 'c'.repeat(64), bonsaiSnapshotSha256: 'd'.repeat(64) },
  };
}

function pending() {
  return prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:05:00.000Z',
  });
}

test('prepares all source-backed task links in separate evidence and dependency tiers', () => {
  const record = pending();
  assert.deepEqual(record.summary.byTier, {
    DIRECT_EXACT: { total: 1, approved: 0, rejected: 0, pending: 1 },
    PROJECT_DEPENDENT_EXACT: { total: 1, approved: 0, rejected: 0, pending: 1 },
    NEAR_TITLE: { total: 1, approved: 0, rejected: 0, pending: 1 },
  });
  assert.equal(record.candidates[0].mappingDependency.kind, 'PROJECT_ALIAS');
  assert.equal(record.candidates[1].mappingDependency, null);
  assert.equal(record.candidates[2].mappingDependency.kind, 'NEAR_TITLE_TASK_LINK');
  assert.equal(record.safeguards.ownerAssignmentsAuthorized, false);
  assert.equal(verifyNotionBonsaiTaskLinkDecision({ review: review(), reviewSha256: REVIEW_HASH, record }).valid, true);
});

test('records an independent direct task decision without granting mutation authority', () => {
  const base = pending();
  const direct = base.candidates.find(candidate => candidate.evidenceTier === 'DIRECT_EXACT');
  const record = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [{ candidateId: direct.candidateId, decision: 'APPROVED' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'decision-1',
  });
  assert.equal(record.summary.approved, 1);
  assert.equal(record.summary.pending, 2);
  assert.equal(record.sourceEvidence.mappingDecisionSha256, null);
  assert.equal(record.safeguards.taskLinksApplied, false);
  assert.equal(verifyNotionBonsaiTaskLinkDecision({ review: review(), reviewSha256: REVIEW_HASH, record }).valid, true);
});

test('requires the exact approved mapping before approving a conditional task link', () => {
  const base = pending();
  const conditional = base.candidates.find(candidate => candidate.evidenceTier === 'PROJECT_DEPENDENT_EXACT');
  const pendingMapping = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:04:00.000Z',
  });
  assert.throws(() => prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [{ candidateId: conditional.candidateId, decision: 'APPROVED' }],
    mappingDecision: pendingMapping, mappingDecisionSha256: MAPPING_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'decision-2',
  }), /approved mapping dependency/);
  const approvedMapping = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:05:00.000Z',
    decisions: pendingMapping.candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    approver: 'Cameron', decidedAt: '2026-08-28T01:04:30.000Z', reference: 'mapping-1',
  });
  const record = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [{ candidateId: conditional.candidateId, decision: 'APPROVED' }],
    mappingDecision: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'decision-2',
  });
  assert.equal(verifyNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, record,
    mappingDecision: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
  }).valid, true);
});

test('rejects changed identities, duplicate decisions, and unsafe safeguards', () => {
  const base = pending();
  assert.throws(() => prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [
      { candidateId: base.candidates[0].candidateId, decision: 'APPROVED' },
      { candidateId: base.candidates[0].candidateId, decision: 'REJECTED' },
    ],
  }), /Duplicate task-link decision/);
  const altered = pending();
  altered.candidates[0].bonsaiTitle = 'Changed';
  assert.ok(verifyNotionBonsaiTaskLinkDecision({ review: review(), reviewSha256: REVIEW_HASH, record: altered }).findings.includes('CANDIDATE_SET_MISMATCH'));
  const unsafe = pending();
  unsafe.safeguards.ownerAssignmentsAuthorized = true;
  assert.ok(verifyNotionBonsaiTaskLinkDecision({ review: review(), reviewSha256: REVIEW_HASH, record: unsafe }).findings.includes('SAFEGUARD_MISMATCH'));
});

test('CLI creates a new pending packet, refuses overwrite, and requires confirmation for decisions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-link-decision-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'decision.json');
    const decisionsPath = path.join(temp, 'decisions.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    fs.writeFileSync(decisionsPath, JSON.stringify({ decisions: [{ candidateId: pending().candidates[1].candidateId, decision: 'APPROVED' }] }));
    const base = ['scripts/prepare-notion-bonsai-task-link-decision.mjs', '--review', reviewPath, '--prepared-at', '2026-08-28T01:06:00.000Z', '--output', outputPath];
    const first = spawnSync(process.execPath, base, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 3);
    assert.equal(spawnSync(process.execPath, base, { encoding: 'utf8' }).status, 2);
    const unconfirmed = spawnSync(process.execPath, [...base.slice(0, -1), path.join(temp, 'approved.json'), '--decisions', decisionsPath], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
