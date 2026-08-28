import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import { prepareNotionBonsaiProjectDispositionDecision } from '../../services/notionBonsaiProjectDispositionDecision.service.js';
import {
  prepareNotionBonsaiProjectDispositionReviewBrief,
  verifyNotionBonsaiProjectDispositionReviewBrief,
} from '../../services/notionBonsaiProjectDispositionReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'b'.repeat(64);
const DISPOSITION_HASH = 'c'.repeat(64);

function review() {
  const bonsai = [
    [101, 'Linked Bonsai', 'Client A'], [102, 'Source only', 'Client B'],
    [103, 'Repeated distinct', 'Client C'], [104, 'Repeated distinct', 'Client D'],
    [105, 'Repeated same', 'Client E'], [106, 'Repeated same', 'Client E'],
  ];
  return {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [], taskEvidencedProjectCandidates: [],
    possibleTitlePairs: [{
      notionSourceId: 'https://app.notion.com/n1', notionProject: 'Linked Notion', notionStatus: 'Active',
      bonsaiProjectId: 101, bonsaiProject: 'Linked Bonsai', bonsaiStatus: 'active', evidence: 'TITLE_SUGGESTION_ONLY',
      reviewScore: 0.8, titleTokenDiceSimilarity: 0.8, companyTokenDiceSimilarity: 0, candidateRank: 1,
    }],
    unmatchedNotionProjects: [
      { notionSourceId: 'https://app.notion.com/n1', project: 'Linked Notion', status: 'Active' },
      { notionSourceId: 'https://app.notion.com/n2', project: 'Notion source only', status: 'Active' },
    ],
    unmatchedBonsaiProjects: bonsai.map(([bonsaiProjectId, project, company]) => ({
      bonsaiProjectId, project, company, status: 'active', url: `https://example.test/${bonsaiProjectId}`,
    })),
    duplicateBonsaiTitles: [
      { title: 'Repeated distinct', projects: bonsai.slice(2, 4).map(([id, , company]) => ({ id, status: 'active', company, url: `https://example.test/${id}` })) },
      { title: 'Repeated same', projects: bonsai.slice(4, 6).map(([id, , company]) => ({ id, status: 'active', company, url: `https://example.test/${id}` })) },
    ],
    summary: { notionProjects: 2, bonsaiProjects: 6 },
    sourceEvidence: {
      notionSnapshotSha256: 'd'.repeat(64), bonsaiProjectSnapshotSha256: 'e'.repeat(64), taskReviewSha256: 'f'.repeat(64),
    },
  };
}

function linkDecision(decision = 'PENDING', reviewHash = REVIEW_HASH) {
  const pending = prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: reviewHash, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  if (decision === 'PENDING') return pending;
  return prepareNotionBonsaiNativeProjectLinkDecision({
    review: review(), reviewSha256: reviewHash, preparedAt: '2026-08-28T01:02:00.000Z',
    decisions: [{ candidateId: pending.candidates[0].candidateId, decision }],
    approver: 'Cameron', decidedAt: '2026-08-28T01:01:30.000Z', reference: 'link-review',
  });
}

function pendingDisposition(links = linkDecision(), reviewHash = REVIEW_HASH, linkHash = LINK_HASH) {
  return prepareNotionBonsaiProjectDispositionDecision({
    review: review(), reviewSha256: reviewHash, projectLinkDecision: links,
    projectLinkDecisionSha256: linkHash, preparedAt: '2026-08-28T01:03:00.000Z',
  });
}

function brief(links = linkDecision()) {
  return prepareNotionBonsaiProjectDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: links,
    projectLinkDecisionSha256: LINK_HASH, projectDispositionDecision: pendingDisposition(links),
    projectDispositionDecisionSha256: DISPOSITION_HASH, preparedAt: '2026-08-28T01:04:00.000Z',
  });
}

test('separates source migration, pending links, distinct clients, and same-client manual review', () => {
  const record = brief();
  assert.equal(record.complete, false);
  assert.deepEqual(record.summary, {
    total: 10, approvalReady: 7, blocked: 2, manualReview: 1,
    byRecommendedDisposition: { RESOLVED_BY_APPROVED_LINK: 0, MIGRATE_TO_HUB: 6, RETAIN_DISTINCT_WITH_EVIDENCE: 1 },
    bySourceKind: {
      NOTION_PROJECT: { total: 2, approvalReady: 1, blocked: 1, manualReview: 0 },
      BONSAI_PROJECT: { total: 6, approvalReady: 5, blocked: 1, manualReview: 0 },
      BONSAI_DUPLICATE_TITLE_GROUP: { total: 2, approvalReady: 1, blocked: 0, manualReview: 1 },
    },
  });
  const sourceMember = record.candidates.find(candidate => candidate.bonsaiProjectId === '103');
  assert.equal(sourceMember.recommendedDisposition, 'MIGRATE_TO_HUB');
  assert.ok(sourceMember.prerequisites.some(value => value.includes('bonsai_duplicate_title_group')));
  assert.equal(record.safeguards.projectDispositionDecisionsRecorded, false);
  assert.equal(record.safeguards.duplicateGroupsConsolidated, false);
});

test('turns one approved link into exact source resolutions without applying the link', () => {
  const approved = linkDecision('APPROVED');
  const record = brief(approved);
  assert.equal(record.summary.blocked, 0);
  assert.equal(record.summary.byRecommendedDisposition.RESOLVED_BY_APPROVED_LINK, 2);
  const resolved = record.candidates.filter(candidate => candidate.recommendedDisposition === 'RESOLVED_BY_APPROVED_LINK');
  assert.equal(resolved.length, 2);
  assert.ok(resolved.every(candidate => candidate.projectLinkCandidateId === approved.candidates[0].candidateId));
  assert.equal(record.safeguards.projectLinksApplied, false);
});

test('rejects a decided or tampered disposition packet', () => {
  const disposition = pendingDisposition();
  disposition.candidates[0].disposition = 'REPAIR_SOURCE_AND_RECAPTURE';
  assert.throws(() => prepareNotionBonsaiProjectDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: linkDecision(),
    projectLinkDecisionSha256: LINK_HASH, projectDispositionDecision: disposition,
    projectDispositionDecisionSha256: DISPOSITION_HASH, preparedAt: '2026-08-28T01:04:00.000Z',
  }), /fully pending/);
});

test('detects a changed recommendation', () => {
  const altered = brief();
  altered.candidates.find(candidate => candidate.recommendation === 'BLOCKED').recommendedDisposition = 'MIGRATE_TO_HUB';
  const result = verifyNotionBonsaiProjectDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: linkDecision(),
    projectLinkDecisionSha256: LINK_HASH, projectDispositionDecision: pendingDisposition(),
    projectDispositionDecisionSha256: DISPOSITION_HASH, record: altered,
  });
  assert.equal(result.valid, false);
  assert.ok(result.findings.includes('REVIEW_BRIEF_MISMATCH'));
});

test('CLI creates an owner-only brief, verifies it, and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-disposition-review-brief-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const linkPath = path.join(temp, 'link.json');
    const dispositionPath = path.join(temp, 'disposition.json');
    const outputPath = path.join(temp, 'brief.json');
    const reviewBytes = Buffer.from(JSON.stringify(review()));
    const reviewHash = crypto.createHash('sha256').update(reviewBytes).digest('hex');
    const links = linkDecision('PENDING', reviewHash);
    const linkBytes = Buffer.from(JSON.stringify(links));
    const linkHash = crypto.createHash('sha256').update(linkBytes).digest('hex');
    const disposition = pendingDisposition(links, reviewHash, linkHash);
    fs.writeFileSync(reviewPath, reviewBytes);
    fs.writeFileSync(linkPath, linkBytes);
    fs.writeFileSync(dispositionPath, JSON.stringify(disposition));
    const args = [
      'scripts/prepare-notion-bonsai-project-disposition-review-brief.mjs', '--review', reviewPath,
      '--project-link-decision', linkPath, '--project-disposition-decision', dispositionPath,
      '--prepared-at', '2026-08-28T01:04:00.000Z', '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    if (process.platform !== 'win32') assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-project-disposition-review-brief.mjs', reviewPath, linkPath, dispositionPath, outputPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
