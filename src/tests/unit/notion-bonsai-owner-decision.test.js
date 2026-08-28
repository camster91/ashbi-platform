import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepareNotionBonsaiOwnerDecision,
  verifyNotionBonsaiOwnerDecision,
} from '../../services/notionBonsaiOwnerDecision.service.js';
import { prepareNotionBonsaiMappingDecision } from '../../services/notionBonsaiMappingDecision.service.js';
import { prepareNotionBonsaiTaskLinkDecision } from '../../services/notionBonsaiTaskLinkDecision.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const MAPPING_HASH = 'd'.repeat(64);
const TASK_LINK_HASH = 'e'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, preparedAt: '2026-08-28T00:48:15.717Z',
    exactTaskLinks: [
      { notionSourceId: 'notion-1', bonsaiSourceId: 'bonsai-1', taskTitle: 'Direct', notionProject: 'Site', bonsaiProject: 'Site', bonsaiOwner: 'Cameron', projectTitleMatch: true },
      { notionSourceId: 'notion-2', bonsaiSourceId: 'bonsai-2', taskTitle: 'Alias', notionProject: 'Brand', bonsaiProject: 'Brand Retainer', bonsaiOwner: 'Bianca', projectTitleMatch: false },
    ],
    projectAliasCandidates: [{ notionProject: 'Brand', bonsaiProject: 'Brand Retainer', evidence: [{ notionSourceId: 'notion-2', bonsaiSourceId: 'bonsai-2', taskTitle: 'Alias' }] }],
    nearTitleCandidates: [{ notionSourceId: 'notion-3', bonsaiSourceId: 'bonsai-3', notionTitle: 'Review the update', bonsaiTitle: 'Review update', notionProject: 'Support', bonsaiProject: 'Support Plan', bonsaiOwner: 'Cameron', tokenDiceSimilarity: 0.9 }],
    sourceEvidence: { notionSnapshotSha256: 'b'.repeat(64), bonsaiSnapshotSha256: 'c'.repeat(64) },
  };
}

function pending() {
  return prepareNotionBonsaiOwnerDecision({ review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:00:00Z' });
}

test('prepares only source-backed owner candidates and exposes mapping dependencies', () => {
  const record = pending();
  assert.deepEqual(record.summary, {
    total: 3, direct: 1, conditional: 2, approved: 0, rejected: 0, pending: 3,
    byOwner: [{ ownerName: 'Bianca', taskCount: 1 }, { ownerName: 'Cameron', taskCount: 2 }],
  });
  assert.equal(record.complete, false);
  assert.equal(record.safeguards.ownerAssignmentsApplied, false);
  assert.equal(verifyNotionBonsaiOwnerDecision({ review: review(), reviewSha256: REVIEW_HASH, record }).valid, true);
});

test('candidate approvals require their exact approved task identities', () => {
  const mappingCandidates = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:00:45Z',
  });
  const approvedMapping = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00Z',
    decisions: mappingCandidates.candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    approver: 'Cameron', decidedAt: '2026-08-28T01:00:30Z', reference: 'mapping-approval-ref',
  });
  const pendingLinks = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:10Z',
  });
  const approvedLinks = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:20Z',
    decisions: pendingLinks.candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    mappingDecision: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:15Z', reference: 'task-link-approval-ref',
  });
  const record = prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decisions: pending().candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    mappingDecisionRecord: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    taskLinkDecisionRecord: approvedLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-approval-ref',
  });
  const result = verifyNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, record,
    mappingDecisionRecord: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    taskLinkDecisionRecord: approvedLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
  });
  assert.equal(result.valid, true);
  assert.equal(result.approved, 3);
  assert.equal(record.safeguards.ownerAssignmentsApplied, false);
});

test('rejects a changed owner and cannot approve without an approved task identity', () => {
  const changed = pending();
  changed.candidates[0].proposedOwner = 'Different Owner';
  const result = verifyNotionBonsaiOwnerDecision({ review: review(), reviewSha256: REVIEW_HASH, record: changed });
  assert.ok(result.findings.includes('CANDIDATE_SET_MISMATCH'));
  const alias = pending().candidates.find(candidate => candidate.mappingDependency === 'PROJECT_ALIAS_APPROVAL');
  const pendingLinks = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:10Z',
  });
  assert.throws(() => prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decisions: [{ candidateId: alias.candidateId, decision: 'APPROVED' }],
    taskLinkDecisionRecord: pendingLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-approval-ref',
  }), /approved valid task identity/);
});

test('cannot approve owners before the task identities are approved', () => {
  const mappingCandidates = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:00:45Z',
  });
  const approvedMapping = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00Z',
    decisions: mappingCandidates.candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    approver: 'Cameron', decidedAt: '2026-08-28T01:00:30Z', reference: 'mapping-approval-ref',
  });
  const pendingLinks = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:10Z',
  });
  assert.throws(() => prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decisions: pending().candidates.map(candidate => ({ candidateId: candidate.candidateId, decision: 'APPROVED' })),
    mappingDecisionRecord: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    taskLinkDecisionRecord: pendingLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-approval-ref',
  }), /approved valid task identity/);
});

test('records direct exact owner approvals while conditional candidates remain pending', () => {
  const owner = pending();
  const links = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:10Z',
  });
  const directLink = links.candidates.find(candidate => candidate.evidenceTier === 'DIRECT_EXACT');
  const approvedLinks = prepareNotionBonsaiTaskLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:20Z',
    decisions: [{ candidateId: directLink.candidateId, decision: 'APPROVED' }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:15Z', reference: 'direct-task-link-ref',
  });
  const directOwner = owner.candidates.find(candidate => candidate.mappingDependency === null);
  const record = prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decisions: [{ candidateId: directOwner.candidateId, decision: 'APPROVED' }],
    taskLinkDecisionRecord: approvedLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-rule-direct-exact',
  });
  assert.equal(record.summary.approved, 1);
  assert.equal(record.summary.pending, 2);
  assert.equal(record.complete, false);
  assert.equal(verifyNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, record,
    taskLinkDecisionRecord: approvedLinks, taskLinkDecisionSha256: TASK_LINK_HASH,
  }).valid, true);
});

test('CLI creates and verifies one immutable pending owner packet', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-bonsai-owner-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'owner.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    const args = ['scripts/prepare-notion-bonsai-owner-decision.mjs', '--review', reviewPath, '--prepared-at', '2026-08-28T01:00:00Z', '--output', outputPath];
    const prepared = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 3);
    const verified = spawnSync(process.execPath, ['scripts/verify-notion-bonsai-owner-decision.mjs', '--review', reviewPath, '--owner-decision', outputPath], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const decisionsPath = path.join(temp, 'decisions.json');
    fs.writeFileSync(decisionsPath, JSON.stringify({ decisions: [] }));
    const decidedPath = path.join(temp, 'decided.json');
    assert.equal(spawnSync(process.execPath, [...args.slice(0, -1), decidedPath, '--decisions', decisionsPath], { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
