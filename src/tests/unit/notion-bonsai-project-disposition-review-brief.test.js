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

function supplementalEvidence(conclusion = 'SAME_LOGICAL_PROJECT') {
  return {
    format: 'ashbi-notion-bonsai-duplicate-project-live-evidence',
    version: 1,
    scope: 'SAME_CLIENT_DUPLICATE_TITLE_GROUPS_ONLY',
    preparedAt: '2026-08-28T01:03:30.000Z',
    sourceObservedAt: '2026-08-28T01:03:00.000Z',
    candidates: [{
      candidateId: 'project-disposition:bonsai_duplicate_title_group:repeated%20same',
      title: 'Repeated same', conclusion, inference: true,
      members: [105, 106].map(id => ({
        bonsaiProjectId: String(id), projectNumber: `CLI-${id}`, status: 'active', company: 'Client E',
        dateWindow: 'Jan 1 - Jan 31, 2026', invoiceCount: 0, invoiceNumberRange: null,
        invoiceIssuedDateRange: null, contractCount: 0, taskCount: 0, timeEntryCount: 0, noteCount: 0,
      })),
      signals: [
        { type: 'EXACT_WINDOW', value: 'Same exact client and date window.' },
        { type: 'SEPARATE_OR_EMPTY_EVIDENCE', value: 'Bounded project history supports the conclusion.' },
      ],
    }],
    evidenceMeaning: 'Identity evidence only.',
    safeguards: {
      externalWritesPerformed: false, projectDispositionDecisionsRecorded: false, projectLinksApplied: false,
      duplicateGroupsConsolidated: false, projectsCreatedChangedArchivedOrDeleted: false,
      tasksOwnersLifecycleOrFinancialsChanged: false, paymentSettlementEvidenceComplete: false,
      migrationOrCutoverAuthorized: false,
    },
  };
}

function brief(links = linkDecision(), supplemental = null) {
  return prepareNotionBonsaiProjectDispositionReviewBrief({
    review: review(), reviewSha256: REVIEW_HASH, projectLinkDecision: links,
    projectLinkDecisionSha256: LINK_HASH, projectDispositionDecision: pendingDisposition(links),
    projectDispositionDecisionSha256: DISPOSITION_HASH, supplementalEvidence: supplemental,
    supplementalEvidenceSha256: supplemental ? '9'.repeat(64) : null,
    preparedAt: '2026-08-28T01:04:00.000Z',
  });
}

test('separates source migration, pending links, distinct clients, and same-client manual review', () => {
  const record = brief();
  assert.equal(record.complete, false);
  assert.deepEqual(record.summary, {
    total: 10, approvalReady: 7, blocked: 2, manualReview: 1,
    byRecommendedDisposition: {
      RESOLVED_BY_APPROVED_LINK: 0, MIGRATE_TO_HUB: 6,
      RETAIN_DISTINCT_WITH_EVIDENCE: 1, MANUALLY_MAP_MEMBERS_WITH_EVIDENCE: 0,
    },
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

test('promotes exact same-client live evidence to a bounded group recommendation', () => {
  const record = brief(linkDecision(), supplementalEvidence());
  assert.equal(record.summary.approvalReady, 8);
  assert.equal(record.summary.manualReview, 0);
  assert.equal(record.summary.byRecommendedDisposition.MANUALLY_MAP_MEMBERS_WITH_EVIDENCE, 1);
  const group = record.candidates.find(candidate => candidate.project === 'Repeated same');
  assert.equal(group.reasonCode, 'CHECKSUM_BOUND_LIVE_SAME_LOGICAL_PROJECT_EVIDENCE');
  assert.equal(group.supportingEvidenceCandidateId, group.candidateId);
  assert.equal(record.sourceEvidence.supplementalEvidenceSha256, '9'.repeat(64));

  const distinct = brief(linkDecision(), supplementalEvidence('RETAIN_DISTINCT'));
  assert.equal(distinct.candidates.find(candidate => candidate.project === 'Repeated same').recommendedDisposition,
    'RETAIN_DISTINCT_WITH_EVIDENCE');
});

test('rejects supplemental evidence that changes membership or weakens safeguards', () => {
  const changed = supplementalEvidence();
  changed.candidates[0].members[0].bonsaiProjectId = '999';
  assert.throws(() => brief(linkDecision(), changed), /does not bind the source project/);

  const unsafe = supplementalEvidence();
  unsafe.safeguards.projectLinksApplied = true;
  assert.throws(() => brief(linkDecision(), unsafe), /safeguards/);
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
    const supplementalPath = path.join(temp, 'supplemental.json');
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
    fs.writeFileSync(supplementalPath, JSON.stringify(supplementalEvidence()));
    const args = [
      'scripts/prepare-notion-bonsai-project-disposition-review-brief.mjs', '--review', reviewPath,
      '--project-link-decision', linkPath, '--project-disposition-decision', dispositionPath,
      '--supplemental-evidence', supplementalPath,
      '--prepared-at', '2026-08-28T01:04:00.000Z', '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    if (process.platform !== 'win32') assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
    const verify = spawnSync(process.execPath, [
      'scripts/verify-notion-bonsai-project-disposition-review-brief.mjs', reviewPath, linkPath, dispositionPath, outputPath,
      supplementalPath,
    ], { encoding: 'utf8' });
    assert.equal(verify.status, 0, verify.stderr);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
