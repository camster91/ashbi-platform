import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import { prepareNotionBonsaiProjectDispositionDecision } from '../../services/notionBonsaiProjectDispositionDecision.service.js';
import {
  prepareBonsaiActiveProjectDispositionDecision,
  verifyBonsaiActiveProjectDispositionDecision,
} from '../../services/bonsaiActiveProjectDispositionDecision.service.js';
import {
  ACTIVE_PROJECT_OUTCOME_KIND,
  exportActiveProjectOutcomeDecision,
  importActiveProjectOutcomeReviewPacket,
  recordMigrationReviewDecision,
} from '../../services/migrationReview.service.js';
import {
  prepareBonsaiActiveProjectOutcomeReviewBrief,
  verifyBonsaiActiveProjectOutcomeReviewBrief,
} from '../../services/bonsaiActiveProjectOutcomeReviewBrief.service.js';

const H = { review: 'a'.repeat(64), link: 'b'.repeat(64), projectDisposition: 'c'.repeat(64), triage: 'd'.repeat(64), financial: 'e'.repeat(64), active: 'f'.repeat(64), project: '1'.repeat(64), task: '2'.repeat(64), invoice: '3'.repeat(64), time: '4'.repeat(64) };

function review() {
  return {
    format: 'ashbi-notion-bonsai-native-project-review', version: 1, preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [{ notionSourceId: 'https://notion.test/1', notionProject: 'Project', notionStatus: 'Active', bonsaiProjectId: 101, bonsaiProject: 'Project', bonsaiStatus: 'active', evidence: 'EXACT_UNIQUE_PROJECT_TITLE', lifecycleMatch: true }],
    taskEvidencedProjectCandidates: [], possibleTitlePairs: [], unmatchedNotionProjects: [], unmatchedBonsaiProjects: [], duplicateBonsaiTitles: [],
    summary: { notionProjects: 1, bonsaiProjects: 1 },
    sourceEvidence: { notionSnapshotSha256: '5'.repeat(64), bonsaiProjectSnapshotSha256: H.project, taskReviewSha256: '6'.repeat(64) },
  };
}

function options(approved = false) {
  const nativeProjectReview = review();
  const pendingLinks = prepareNotionBonsaiNativeProjectLinkDecision({ review: nativeProjectReview, reviewSha256: H.review, preparedAt: '2026-08-28T01:01:00.000Z' });
  const projectLinkDecision = approved ? prepareNotionBonsaiNativeProjectLinkDecision({ review: nativeProjectReview, reviewSha256: H.review, preparedAt: '2026-08-28T01:02:00.000Z', decisions: [{ candidateId: pendingLinks.candidates[0].candidateId, decision: 'APPROVED' }], approver: 'Cameron', decidedAt: '2026-08-28T01:01:30.000Z', reference: 'link-review' }) : pendingLinks;
  const pendingDisposition = prepareNotionBonsaiProjectDispositionDecision({ review: nativeProjectReview, reviewSha256: H.review, projectLinkDecision, projectLinkDecisionSha256: H.link, preparedAt: '2026-08-28T01:03:00.000Z' });
  const projectDispositionDecision = approved ? prepareNotionBonsaiProjectDispositionDecision({ review: nativeProjectReview, reviewSha256: H.review, projectLinkDecision, projectLinkDecisionSha256: H.link, preparedAt: '2026-08-28T01:04:00.000Z', decisions: pendingDisposition.candidates.map(candidate => ({ candidateId: candidate.candidateId, disposition: 'RESOLVED_BY_APPROVED_LINK', rationale: 'Approved identity', reference: 'link-review', projectLinkCandidateId: projectLinkDecision.candidates[0].candidateId })), approver: 'Cameron', decidedAt: '2026-08-28T01:03:30.000Z', reference: 'project-disposition-review' }) : pendingDisposition;
  const triage = {
    format: 'ashbi-bonsai-active-project-triage', version: 1, preparedAt: '2026-08-28T01:05:00.000Z', summary: { activeProjects: 1 },
    records: [{ bonsaiProjectId: 101, project: 'Project', company: 'Client', url: 'https://bonsai.test/101', projectGroup: { id: 'group', name: 'In Progress', state: 'active' }, taskEvidence: { total: 1, taskSourceIds: ['task'] }, notionEvidence: { notionSourceId: 'https://notion.test/1' }, duplicateTitleGroup: false, triageBucket: 'PROVEN_EXACT_LINK_REVIEW' }],
    sourceEvidence: { bonsaiProjectSnapshotSha256: H.project, bonsaiTaskSnapshotSha256: H.task, projectGroupSnapshotSha256: '7'.repeat(64), nativeProjectReviewSha256: H.review },
  };
  const financialReview = {
    format: 'ashbi-bonsai-active-project-financial-review', version: 1, preparedAt: '2026-08-28T01:06:00.000Z', summary: { activeProjects: 1 },
    records: [{ bonsaiProjectId: 101, invoiceEvidence: { invoiceCount: 1, nonPaidInvoiceCount: 1 }, timeEvidence: { entryCount: 0, unbilledEntryCount: 0 }, paymentEvidence: { checked: false }, contractEvidence: { checked: false }, financialAttentionReasons: ['NON_PAID_INVOICE'], closureAuthorized: false }],
    sourceEvidence: { activeProjectTriageSha256: H.triage, invoiceSnapshotSha256: H.invoice, timeEntrySnapshotSha256: H.time },
  };
  const base = { triage, triageSha256: H.triage, financialReview, financialReviewSha256: H.financial, nativeProjectReview, nativeProjectReviewSha256: H.review, projectLinkDecision, projectLinkDecisionSha256: H.link, projectDispositionDecision, projectDispositionDecisionSha256: H.projectDisposition };
  const decision = prepareBonsaiActiveProjectDispositionDecision({ ...base, preparedAt: '2026-08-28T01:07:00.000Z' });
  return { ...base, decision, decisionSha256: H.active, preparedAt: '2026-08-28T01:08:00.000Z' };
}

function fakePrisma() {
  const packets = [];
  const decisions = [];
  return {
    migrationReviewPacket: {
      async findFirst({ where }) { const row = packets.find(item => Object.entries(where).every(([key, value]) => item[key] === value)); return row ? { ...row, decisions: decisions.filter(item => item.packetId === row.id).sort((a, b) => b.decidedAt - a.decidedAt) } : null; },
      async findMany() { return packets.map(row => ({ ...row, decisions: decisions.filter(item => item.packetId === row.id) })); },
      async create({ data }) { const row = { id: `packet-${packets.length + 1}`, ...data, updatedAt: data.createdAt }; packets.push(row); return { ...row, decisions: [] }; },
    },
    migrationReviewDecision: {
      async findFirst({ where }) { return decisions.find(item => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null; },
      async create({ data }) { const row = { id: `decision-${decisions.length + 1}`, ...data, createdAt: data.decidedAt }; decisions.push(row); return row; },
    },
  };
}

function importInput(source, requestId) {
  const { decision, decisionSha256, preparedAt: _preparedAt, ...dependencies } = source;
  return {
    format: 'ashbi-hub-active-project-outcome-review-import', version: 1, requestId,
    ...dependencies, dispositionDecision: decision, dispositionDecisionSha256: decisionSha256,
    reviewBrief: prepareBonsaiActiveProjectOutcomeReviewBrief(source),
  };
}

test('keeps active outcomes blocked until project identity and disposition decisions are complete', () => {
  const record = prepareBonsaiActiveProjectOutcomeReviewBrief(options());
  assert.deepEqual(record.summary, { total: 1, approvalReady: 0, blocked: 1, manualReview: 0, closureRecommended: 0, byRecommendedOutcome: { MIGRATE_ACTIVE_TO_HUB: 0, RETAIN_ACTIVE_IN_BONSAI: 0, EXCLUDE_ACTIVE_WITH_EVIDENCE: 0 } });
  assert.equal(record.safeguards.projectsClosedOrArchived, false);
  assert.equal(record.candidates[0].reasonCode, 'PROJECT_IDENTITY_OR_SOURCE_DISPOSITION_PENDING');
});

test('recommends only the compatible active outcome after upstream approval and never closure', () => {
  const input = options(true);
  const record = prepareBonsaiActiveProjectOutcomeReviewBrief(input);
  assert.equal(record.summary.approvalReady, 1);
  assert.equal(record.summary.closureRecommended, 0);
  assert.equal(record.candidates[0].recommendedOutcome, 'MIGRATE_ACTIVE_TO_HUB');
  assert.equal(verifyBonsaiActiveProjectOutcomeReviewBrief({ ...input, record }).valid, true);
  record.candidates[0].recommendedOutcome = 'CLOSE_AFTER_FINANCIAL_CLEARANCE';
  assert.equal(verifyBonsaiActiveProjectOutcomeReviewBrief({ ...input, record }).valid, false);
});

test('Hub import is replay-safe and exports only an approved compatible active outcome', async () => {
  const prismaClient = fakePrisma();
  const source = options(true);
  const input = importInput(source, '11111111-1111-4111-8111-111111111111');
  const first = await importActiveProjectOutcomeReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:09:00.000Z') });
  const replay = await importActiveProjectOutcomeReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  assert.equal(first.packet.kind, ACTIVE_PROJECT_OUTCOME_KIND);
  assert.equal(replay.replayed, true);
  await recordMigrationReviewDecision({ prismaClient, packetId: first.packet.id, candidateId: first.packet.candidates[0].candidateId, requestId: '22222222-2222-4222-8222-222222222222', decision: 'APPROVED', reviewedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:10:00.000Z') });
  const record = await exportActiveProjectOutcomeDecision({ prismaClient, packetId: first.packet.id, now: new Date('2026-08-28T01:11:00.000Z') });
  const verification = verifyBonsaiActiveProjectDispositionDecision({ ...source, record });
  assert.equal(verification.valid, true);
  assert.equal(verification.decided, 1);
  assert.equal(record.candidates[0].outcome, 'MIGRATE_ACTIVE_TO_HUB');
  assert.equal(record.safeguards.projectsClosedOrArchived, false);
});

test('Hub refuses an active outcome while upstream project decisions remain pending', async () => {
  const prismaClient = fakePrisma();
  const source = options();
  const input = importInput(source, '33333333-3333-4333-8333-333333333333');
  const imported = await importActiveProjectOutcomeReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  await assert.rejects(recordMigrationReviewDecision({ prismaClient, packetId: imported.packet.id, candidateId: imported.packet.candidates[0].candidateId, requestId: '44444444-4444-4444-8444-444444444444', decision: 'APPROVED', reviewedBy: 'cameron@ashbi.ca' }), /approval-ready/);
});
