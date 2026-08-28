import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepareNotionBonsaiTaskDispositionDecision,
  verifyNotionBonsaiTaskDispositionDecision,
} from '../../services/notionBonsaiTaskDispositionDecision.service.js';

const HASH = 'a'.repeat(64);
function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    notionOnly: [{ notionSourceId: 'https://app.notion.com/notion1', title: 'Notion task', project: 'Project A', status: 'To do' }],
    bonsaiOnly: [{ bonsaiSourceId: 'bonsai-1', title: 'Bonsai task', project: 'Project B', lifecycleState: 'active', owner: 'Cameron' }],
    bonsaiSourceReview: [{ bonsaiSourceId: 'bonsai-2', title: '', project: 'Project C', lifecycleState: 'complete', owner: null, fields: ['title'] }],
    sourceEvidence: { notionSnapshotSha256: 'b'.repeat(64), bonsaiSnapshotSha256: 'c'.repeat(64) },
  };
}
function pending() {
  return prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:05:00.000Z',
  });
}

test('prepares distinct Notion-only, Bonsai-only, and source-review dispositions', () => {
  const record = pending();
  assert.deepEqual(record.summary, {
    total: 3, pending: 3, decided: 0,
    bySourceKind: { NOTION_ONLY: 1, BONSAI_ONLY: 1, BONSAI_SOURCE_REVIEW: 1 },
    byDisposition: { PENDING: 3 },
  });
  assert.equal(record.safeguards.sourceRecordsDeleted, false);
  assert.equal(record.safeguards.tasksCreatedOrChanged, false);
  assert.equal(verifyNotionBonsaiTaskDispositionDecision({ review: review(), reviewSha256: HASH, record }).valid, true);
});

test('records candidate-specific dispositions only with rationale and evidence', () => {
  const base = pending();
  const notion = base.candidates.find(candidate => candidate.sourceKind === 'NOTION_ONLY');
  const malformed = base.candidates.find(candidate => candidate.sourceKind === 'BONSAI_SOURCE_REVIEW');
  const record = prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [
      { candidateId: notion.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current Notion work', reference: 'review-row-1' },
      { candidateId: malformed.candidateId, disposition: 'REPAIR_SOURCE_AND_RECAPTURE', rationale: 'Missing title', reference: 'review-row-2' },
    ],
    approver: 'Cameron', decidedAt: '2026-08-28T01:05:30.000Z', reference: 'batch-1',
  });
  assert.equal(record.summary.decided, 2);
  assert.equal(record.summary.pending, 1);
  assert.equal(record.complete, false);
  assert.equal(verifyNotionBonsaiTaskDispositionDecision({ review: review(), reviewSha256: HASH, record }).valid, true);
});

test('rejects cross-source dispositions, missing evidence, duplicate decisions, and unsafe mutation claims', () => {
  const base = pending();
  const notion = base.candidates.find(candidate => candidate.sourceKind === 'NOTION_ONLY');
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [{ candidateId: notion.candidateId, disposition: 'RETAIN_BONSAI_ONLY', rationale: 'Wrong', reference: 'ref' }],
  }), /not allowed/);
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [{ candidateId: notion.candidateId, disposition: 'EXCLUDE_WITH_EVIDENCE', rationale: '', reference: '' }],
  }), /rationale and evidence/);
  assert.throws(() => prepareNotionBonsaiTaskDispositionDecision({
    review: review(), reviewSha256: HASH, preparedAt: '2026-08-28T01:06:00.000Z',
    decisions: [
      { candidateId: notion.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'One', reference: 'a' },
      { candidateId: notion.candidateId, disposition: 'RETAIN_NOTION_ONLY', rationale: 'Two', reference: 'b' },
    ],
  }), /Duplicate task disposition/);
  const unsafe = pending();
  unsafe.safeguards.sourceRecordsDeleted = true;
  assert.ok(verifyNotionBonsaiTaskDispositionDecision({ review: review(), reviewSha256: HASH, record: unsafe }).findings.includes('SAFEGUARD_MISMATCH'));
});

test('CLI creates a new pending packet, refuses overwrite, and requires confirmation for decisions', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-disposition-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const outputPath = path.join(temp, 'decision.json');
    const decisionsPath = path.join(temp, 'decisions.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    fs.writeFileSync(decisionsPath, JSON.stringify({ decisions: [{
      candidateId: pending().candidates[0].candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current', reference: 'row-1',
    }] }));
    const args = ['scripts/prepare-notion-bonsai-task-disposition-decision.mjs', '--review', reviewPath, '--prepared-at', '2026-08-28T01:06:00.000Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 3);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const unconfirmed = spawnSync(process.execPath, [...args.slice(0, -1), path.join(temp, 'decided.json'), '--decisions', decisionsPath], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
