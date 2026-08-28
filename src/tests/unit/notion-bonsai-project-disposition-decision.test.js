import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import {
  prepareNotionBonsaiProjectDispositionDecision,
  verifyNotionBonsaiProjectDispositionDecision,
} from '../../services/notionBonsaiProjectDispositionDecision.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'b'.repeat(64);
function review() {
  return {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [], taskEvidencedProjectCandidates: [],
    possibleTitlePairs: [{
      notionSourceId: 'https://app.notion.com/notion1', notionProject: 'Notion project', notionStatus: 'Active',
      bonsaiProjectId: 101, bonsaiProject: 'Bonsai project', bonsaiStatus: 'active', evidence: 'TITLE_SUGGESTION_ONLY',
      reviewScore: 0.8, titleTokenDiceSimilarity: 0.8, companyTokenDiceSimilarity: 0, candidateRank: 1,
    }],
    unmatchedNotionProjects: [{ notionSourceId: 'https://app.notion.com/notion1', project: 'Notion project', status: 'Active' }],
    unmatchedBonsaiProjects: [{ bonsaiProjectId: 101, project: 'Bonsai project', status: 'active', company: 'Client', url: 'https://example.test/project/101' }],
    duplicateBonsaiTitles: [{ title: 'Repeated title', projects: [
      { id: 102, status: 'completed', company: 'Client A', url: 'https://example.test/project/102' },
      { id: 103, status: 'archived', company: 'Client B', url: 'https://example.test/project/103' },
    ] }],
    sourceEvidence: {
      notionSnapshotSha256: 'c'.repeat(64), bonsaiProjectSnapshotSha256: 'd'.repeat(64), taskReviewSha256: 'e'.repeat(64),
    },
  };
}
function linkDecision(decision = 'PENDING') {
  const pending = prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  if (decision === 'PENDING') return pending;
  return prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:02:00.000Z',
    decisions: [{ candidateId: pending.candidates[0].candidateId, decision }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30.000Z', reference: 'link-review-1',
  });
}
function pending() {
  return prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH,
    projectLinkDecision: linkDecision(), projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
}

test('prepares all source-only projects and duplicate-title groups without mutation authority', () => {
  const record = pending();
  assert.deepEqual(record.summary, {
    total: 3, pending: 3, decided: 0,
    bySourceKind: { NOTION_ONLY: 1, BONSAI_ONLY: 1, BONSAI_DUPLICATE_TITLE_GROUP: 1 },
    byDisposition: { PENDING: 3 },
  });
  assert.equal(record.safeguards.projectsCreatedOrChanged, false);
  assert.equal(record.safeguards.duplicateGroupsConsolidated, false);
  assert.equal(verifyNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: linkDecision(),
    projectLinkDecisionSha256: LINK_HASH, record,
  }).valid, true);
});

test('blocks source-only dispositions while a related project-link decision is pending', () => {
  const candidate = pending().candidates.find(item => item.sourceKind === 'NOTION_ONLY');
  assert.throws(() => prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: linkDecision(), projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:04:00.000Z',
    decisions: [{ candidateId: candidate.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current', reference: 'row-1' }],
  }), /wait for related project-link/);
});

test('records evidence-backed source dispositions only after related links are rejected', () => {
  const rejected = linkDecision('REJECTED');
  const base = prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: rejected, projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
  const notion = base.candidates.find(item => item.sourceKind === 'NOTION_ONLY');
  const bonsai = base.candidates.find(item => item.sourceKind === 'BONSAI_ONLY');
  const group = base.candidates.find(item => item.sourceKind === 'BONSAI_DUPLICATE_TITLE_GROUP');
  const record = prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: rejected, projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:04:00.000Z', approver: 'Cameron', decidedAt: '2026-08-28T01:03:30.000Z', reference: 'batch-1',
    decisions: [
      { candidateId: notion.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Current work', reference: 'row-1' },
      { candidateId: bonsai.candidateId, disposition: 'RETAIN_BONSAI_ONLY', rationale: 'Historical record', reference: 'row-2' },
      { candidateId: group.candidateId, disposition: 'RETAIN_DISTINCT_WITH_EVIDENCE', rationale: 'Different clients', reference: 'row-3' },
    ],
  });
  assert.equal(record.complete, true);
  assert.equal(verifyNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: rejected,
    projectLinkDecisionSha256: LINK_HASH, record,
  }).valid, true);
});

test('requires the exact approved project-link candidate as the disposition resolution', () => {
  const approved = linkDecision('APPROVED');
  const base = prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: approved, projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
  const notion = base.candidates.find(item => item.sourceKind === 'NOTION_ONLY');
  assert.throws(() => prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: approved, projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:04:00.000Z',
    decisions: [{ candidateId: notion.candidateId, disposition: 'MIGRATE_TO_HUB', rationale: 'Wrong', reference: 'row' }],
  }), /exact disposition resolution/);
  const record = prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: approved, projectLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:04:00.000Z', approver: 'Cameron', decidedAt: '2026-08-28T01:03:30.000Z', reference: 'batch-2',
    decisions: [{
      candidateId: notion.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK', rationale: 'Same project',
      reference: 'link-review-1', projectLinkCandidateId: approved.candidates[0].candidateId,
    }],
  });
  assert.equal(record.summary.decided, 1);
});

test('rejects unsafe mutation claims and CLI requires confirmation for decisions', () => {
  const unsafe = pending();
  unsafe.safeguards.projectsCreatedOrChanged = true;
  assert.ok(verifyNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: linkDecision(),
    projectLinkDecisionSha256: LINK_HASH, record: unsafe,
  }).findings.includes('SAFEGUARD_MISMATCH'));

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-disposition-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const linkPath = path.join(temp, 'link.json');
    const outputPath = path.join(temp, 'decision.json');
    const decisionsPath = path.join(temp, 'decisions.json');
    fs.writeFileSync(reviewPath, JSON.stringify(review()));
    const reviewBytes = fs.readFileSync(reviewPath);
    const actualReviewHash = crypto.createHash('sha256').update(reviewBytes).digest('hex');
    fs.writeFileSync(linkPath, JSON.stringify(prepareNotionBonsaiNativeProjectLinkDecision({
      review: review(), reviewSha256: actualReviewHash, preparedAt: '2026-08-28T01:01:00.000Z',
    })));
    fs.writeFileSync(decisionsPath, JSON.stringify({ decisions: [] }));
    const args = ['scripts/prepare-notion-bonsai-project-disposition-decision.mjs', '--review', reviewPath,
      '--project-link-decision', linkPath, '--prepared-at', '2026-08-28T01:03:00.000Z', '--output', outputPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).summary.pending, 3);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const unconfirmed = spawnSync(process.execPath, [...args.slice(0, -1), path.join(temp, 'decided.json'), '--decisions', decisionsPath], { encoding: 'utf8' });
    assert.equal(unconfirmed.status, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
