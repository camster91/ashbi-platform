import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepareNotionBonsaiMappingDecision,
  verifyNotionBonsaiMappingDecision,
} from '../../services/notionBonsaiMappingDecision.service.js';

const HASH = 'a'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, complete: false,
    preparedAt: '2026-08-28T00:48:15.717Z',
    projectAliasCandidates: [{
      notionProject: 'Gloomy Humans', bonsaiProject: 'Gloomy Humans Website',
      evidence: [{ notionSourceId: 'notion-task-1', bonsaiSourceId: 'bonsai-task-1', taskTitle: 'Review launch' }],
    }],
    nearTitleCandidates: [{
      notionSourceId: 'notion-task-2', bonsaiSourceId: 'bonsai-task-2',
      notionTitle: 'Complete the security update', bonsaiTitle: 'Complete security update',
      notionProject: 'Support', bonsaiProject: 'Support Retainer', tokenDiceSimilarity: 0.9,
    }],
    sourceEvidence: { notionSnapshotSha256: 'b'.repeat(64), bonsaiSnapshotSha256: 'c'.repeat(64) },
  };
}

function pending() {
  return prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:00:00Z',
  });
}

test('prepares a source-bound pending record with no mutation authority', () => {
  const record = pending();
  assert.equal(record.complete, false);
  assert.deepEqual(record.summary, { total: 2, approved: 0, rejected: 0, pending: 2 });
  assert.equal(record.candidates[0].decision, 'PENDING');
  assert.equal(record.safeguards.mappingApplied, false);
  assert.equal(record.safeguards.ownerAssignmentsAuthorized, false);
  assert.equal(verifyNotionBonsaiMappingDecision({ review: review(), reviewSha256: HASH, record }).valid, true);
});

test('records an explicit batch approval without applying mappings', () => {
  const record = prepareNotionBonsaiMappingDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:05:00Z',
    decision: 'APPROVED', approver: 'Cameron', decidedAt: '2026-08-28T01:04:00Z', reference: 'codex-user-approval-001',
  });
  const result = verifyNotionBonsaiMappingDecision({ review: review(), reviewSha256: HASH, record });
  assert.equal(record.complete, true);
  assert.deepEqual(record.summary, { total: 2, approved: 2, rejected: 0, pending: 0 });
  assert.equal(result.valid, true);
  assert.equal(record.safeguards.externalWritesPerformed, false);
});

test('rejects altered candidates and a record bound to another review checksum', () => {
  const altered = pending();
  altered.candidates[0].bonsaiProject = 'Different project';
  const result = verifyNotionBonsaiMappingDecision({ review: review(), reviewSha256: HASH, record: altered });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('CANDIDATE_SET_MISMATCH'));
  const checksumMismatch = verifyNotionBonsaiMappingDecision({ review: review(), reviewSha256: 'd'.repeat(64), record: pending() });
  assert.ok(checksumMismatch.findings.includes('SOURCE_EVIDENCE_MISMATCH'));
});

test('CLI creates a pending owner-only file, refuses overwrite, and requires confirm for approval', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-bonsai-decision-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'decision.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    const base = ['scripts/prepare-notion-bonsai-mapping-decision.mjs', '--review', reviewPath, '--prepared-at', '2026-08-28T01:00:00Z', '--output', outputPath];
    const first = spawnSync(process.execPath, base, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 2);
    const second = spawnSync(process.execPath, base, { encoding: 'utf8' });
    assert.equal(second.status, 2);
    const unconfirmed = spawnSync(process.execPath, [...base.slice(0, -1), path.join(temp, 'approved.json'), '--approve-all'], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
