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

const REVIEW_HASH = 'a'.repeat(64);
const MAPPING_HASH = 'd'.repeat(64);

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
    total: 3, direct: 1, conditional: 2, approved: 0, pending: 3,
    byOwner: [{ ownerName: 'Bianca', taskCount: 1 }, { ownerName: 'Cameron', taskCount: 2 }],
  });
  assert.equal(record.complete, false);
  assert.equal(record.safeguards.ownerAssignmentsApplied, false);
  assert.equal(verifyNotionBonsaiOwnerDecision({ review: review(), reviewSha256: REVIEW_HASH, record }).valid, true);
});

test('approval requires the exact completed mapping decision', () => {
  const approvedMapping = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00Z',
    decision: 'APPROVED', approver: 'Cameron', decidedAt: '2026-08-28T01:00:30Z', reference: 'mapping-approval-ref',
  });
  const record = prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decision: 'APPROVED', mappingDecisionRecord: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-approval-ref',
  });
  const result = verifyNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, record,
    mappingDecisionRecord: approvedMapping, mappingDecisionSha256: MAPPING_HASH,
  });
  assert.equal(result.valid, true);
  assert.equal(result.approved, 3);
  assert.equal(record.safeguards.ownerAssignmentsApplied, false);
});

test('rejects a changed owner and cannot approve against a pending mapping decision', () => {
  const changed = pending();
  changed.candidates[0].proposedOwner = 'Different Owner';
  const result = verifyNotionBonsaiOwnerDecision({ review: review(), reviewSha256: REVIEW_HASH, record: changed });
  assert.ok(result.findings.includes('CANDIDATE_SET_MISMATCH'));
  const pendingMapping = prepareNotionBonsaiMappingDecision({ review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00Z' });
  assert.throws(() => prepareNotionBonsaiOwnerDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00Z',
    decision: 'APPROVED', mappingDecisionRecord: pendingMapping, mappingDecisionSha256: MAPPING_HASH,
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30Z', reference: 'owner-approval-ref',
  }), /approved valid mapping decision/);
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
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
