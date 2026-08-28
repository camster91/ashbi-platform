import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  exportProjectDispositionDecision,
  importProjectDispositionReviewPacket,
  PROJECT_DISPOSITION_KIND,
  recordMigrationReviewDecision,
} from '../../services/migrationReview.service.js';
import { prepareNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';
import {
  prepareNotionBonsaiProjectDispositionDecision,
  verifyNotionBonsaiProjectDispositionDecision,
} from '../../services/notionBonsaiProjectDispositionDecision.service.js';
import { prepareNotionBonsaiProjectDispositionReviewBrief } from '../../services/notionBonsaiProjectDispositionReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'b'.repeat(64);
const DISPOSITION_HASH = 'c'.repeat(64);

function review() {
  const bonsai = [
    ['101', 'Linked Bonsai', 'Client A'],
    ['102', 'Bonsai source only', 'Client B'],
    ['103', 'Repeated project', 'Client C'],
    ['104', 'Repeated project', 'Client D'],
  ];
  return {
    format: 'ashbi-notion-bonsai-native-project-review',
    version: 1,
    preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [],
    taskEvidencedProjectCandidates: [],
    possibleTitlePairs: [{
      notionSourceId: 'https://notion.so/n1', notionProject: 'Linked Notion', notionStatus: 'Active',
      bonsaiProjectId: '101', bonsaiProject: 'Linked Bonsai', bonsaiStatus: 'active',
      evidence: 'TITLE_SUGGESTION_ONLY', reviewScore: 0.8, titleTokenDiceSimilarity: 0.8,
      companyTokenDiceSimilarity: 0, candidateRank: 1,
    }],
    unmatchedNotionProjects: [
      { notionSourceId: 'https://notion.so/n1', project: 'Linked Notion', status: 'Active' },
      { notionSourceId: 'https://notion.so/n2', project: 'Notion source only', status: 'Active' },
    ],
    unmatchedBonsaiProjects: bonsai.map(([bonsaiProjectId, project, company]) => ({
      bonsaiProjectId, project, company, status: 'active', url: `https://example.test/${bonsaiProjectId}`,
    })),
    duplicateBonsaiTitles: [{
      title: 'Repeated project',
      projects: bonsai.slice(2).map(([id, , company]) => ({ id, status: 'active', company, url: `https://example.test/${id}` })),
    }],
    summary: { notionProjects: 2, bonsaiProjects: 4 },
    sourceEvidence: {
      notionSnapshotSha256: 'd'.repeat(64),
      bonsaiProjectSnapshotSha256: 'e'.repeat(64),
      taskReviewSha256: 'f'.repeat(64),
    },
  };
}

function input(
  requestId = '11111111-1111-4111-8111-111111111111',
  approveLink = true,
  linkHash = LINK_HASH,
  dispositionHash = DISPOSITION_HASH,
) {
  const source = review();
  const pendingLink = prepareNotionBonsaiNativeProjectLinkDecision({
    review: source, reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  const projectLinkDecision = approveLink ? prepareNotionBonsaiNativeProjectLinkDecision({
    review: source,
    reviewSha256: REVIEW_HASH,
    preparedAt: '2026-08-28T01:02:00.000Z',
    decisions: [{ candidateId: pendingLink.candidates[0].candidateId, decision: 'APPROVED' }],
    approver: 'Cameron',
    decidedAt: '2026-08-28T01:01:30.000Z',
    reference: 'project-link-review',
  }) : pendingLink;
  const dispositionDecision = prepareNotionBonsaiProjectDispositionDecision({
    review: source,
    reviewSha256: REVIEW_HASH,
    projectLinkDecision,
    projectLinkDecisionSha256: linkHash,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
  const reviewBrief = prepareNotionBonsaiProjectDispositionReviewBrief({
    review: source,
    reviewSha256: REVIEW_HASH,
    projectLinkDecision,
    projectLinkDecisionSha256: linkHash,
    projectDispositionDecision: dispositionDecision,
    projectDispositionDecisionSha256: dispositionHash,
    preparedAt: '2026-08-28T01:04:00.000Z',
  });
  return {
    format: 'ashbi-hub-project-disposition-review-import',
    version: 1,
    requestId,
    review: source,
    reviewSha256: REVIEW_HASH,
    projectLinkDecision,
    projectLinkDecisionSha256: linkHash,
    dispositionDecision,
    dispositionDecisionSha256: dispositionHash,
    supplementalEvidence: null,
    supplementalEvidenceSha256: null,
    reviewBrief,
  };
}

function fakePrisma() {
  const packets = [];
  const decisions = [];
  return {
    packets,
    decisions,
    migrationReviewPacket: {
      async findFirst({ where }) {
        const packet = packets.find(item => Object.entries(where).every(([key, value]) => item[key] === value));
        return packet ? { ...packet, decisions: decisions.filter(item => item.packetId === packet.id).sort((a, b) => b.decidedAt - a.decidedAt) } : null;
      },
      async findMany() { return packets.map(packet => ({ ...packet, decisions: [] })); },
      async create({ data }) {
        const packet = { id: `packet-${packets.length + 1}`, ...data, updatedAt: data.createdAt };
        packets.push(packet);
        return { ...packet, decisions: [] };
      },
    },
    migrationReviewDecision: {
      async findFirst({ where }) {
        return decisions.find(item => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null;
      },
      async create({ data }) {
        const row = { id: `decision-${decisions.length + 1}`, ...data, createdAt: data.decidedAt };
        decisions.push(row);
        return row;
      },
    },
  };
}

test('imports project dispositions replay-safely and exports approved recommendations without applying them', async () => {
  const prismaClient = fakePrisma();
  const evidence = input();
  const first = await importProjectDispositionReviewPacket({
    prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:05:00.000Z'),
  });
  const replay = await importProjectDispositionReviewPacket({ prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca' });
  assert.equal(first.packet.kind, PROJECT_DISPOSITION_KIND);
  assert.equal(first.packet.summary.total, 7);
  assert.equal(replay.replayed, true);

  const candidate = first.packet.candidates.find(item => item.recommendedDisposition === 'MIGRATE_TO_HUB');
  await recordMigrationReviewDecision({
    prismaClient,
    packetId: first.packet.id,
    candidateId: candidate.candidateId,
    requestId: '22222222-2222-4222-8222-222222222222',
    decision: 'APPROVED',
    reviewedBy: 'cameron@ashbi.ca',
    now: new Date('2026-08-28T01:06:00.000Z'),
  });
  const record = await exportProjectDispositionDecision({
    prismaClient, packetId: first.packet.id, now: new Date('2026-08-28T01:07:00.000Z'),
  });
  const verified = verifyNotionBonsaiProjectDispositionDecision({
    review: evidence.review,
    reviewSha256: REVIEW_HASH,
    projectLinkDecision: evidence.projectLinkDecision,
    projectLinkDecisionSha256: LINK_HASH,
    record,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.decided, 1);
  assert.equal(record.safeguards.dispositionsApplied, false);
  assert.equal(record.safeguards.duplicateGroupsConsolidated, false);
});

test('does not allow a project disposition blocked by a pending link to be approved', async () => {
  const prismaClient = fakePrisma();
  const evidence = input('33333333-3333-4333-8333-333333333333', false);
  const imported = await importProjectDispositionReviewPacket({ prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca' });
  const blocked = imported.packet.candidates.find(item => item.recommendation === 'BLOCKED');
  await assert.rejects(recordMigrationReviewDecision({
    prismaClient,
    packetId: imported.packet.id,
    candidateId: blocked.candidateId,
    requestId: '44444444-4444-4444-8444-444444444444',
    decision: 'APPROVED',
    reviewedBy: 'cameron@ashbi.ca',
  }), /approval-ready/);
});

test('keeps a regenerated disposition packet alongside the prior source generation', async () => {
  const prismaClient = fakePrisma();
  const pending = input('55555555-5555-4555-8555-555555555555', false);
  const regenerated = input(
    '66666666-6666-4666-8666-666666666666',
    true,
    '1'.repeat(64),
    '2'.repeat(64),
  );
  const first = await importProjectDispositionReviewPacket({ prismaClient, input: pending, importedBy: 'cameron@ashbi.ca' });
  const second = await importProjectDispositionReviewPacket({ prismaClient, input: regenerated, importedBy: 'cameron@ashbi.ca' });
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, false);
  assert.equal(prismaClient.packets.length, 2);
  assert.equal(first.packet.sourceReviewSha256, second.packet.sourceReviewSha256);
  assert.notEqual(first.packet.evidenceFingerprint, second.packet.evidenceFingerprint);
});

test('project-disposition bundle CLI verifies exact files and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-disposition-hub-review-'));
  try {
    const source = review();
    const paths = Object.fromEntries(['review', 'projectLinkDecision', 'dispositionDecision', 'reviewBrief']
      .map(key => [key, path.join(temp, `${key}.json`)]));
    const readHash = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    fs.writeFileSync(paths.review, `${JSON.stringify(source, null, 2)}\n`);
    const pendingLink = prepareNotionBonsaiNativeProjectLinkDecision({
      review: source, reviewSha256: readHash(paths.review), preparedAt: '2026-08-28T01:01:00.000Z',
    });
    const links = prepareNotionBonsaiNativeProjectLinkDecision({
      review: source,
      reviewSha256: readHash(paths.review),
      preparedAt: '2026-08-28T01:02:00.000Z',
      decisions: [{ candidateId: pendingLink.candidates[0].candidateId, decision: 'APPROVED' }],
      approver: 'Cameron', decidedAt: '2026-08-28T01:01:30.000Z', reference: 'project-link-review',
    });
    fs.writeFileSync(paths.projectLinkDecision, `${JSON.stringify(links, null, 2)}\n`);
    const disposition = prepareNotionBonsaiProjectDispositionDecision({
      review: source,
      reviewSha256: readHash(paths.review),
      projectLinkDecision: links,
      projectLinkDecisionSha256: readHash(paths.projectLinkDecision),
      preparedAt: '2026-08-28T01:03:00.000Z',
    });
    fs.writeFileSync(paths.dispositionDecision, `${JSON.stringify(disposition, null, 2)}\n`);
    const brief = prepareNotionBonsaiProjectDispositionReviewBrief({
      review: source,
      reviewSha256: readHash(paths.review),
      projectLinkDecision: links,
      projectLinkDecisionSha256: readHash(paths.projectLinkDecision),
      projectDispositionDecision: disposition,
      projectDispositionDecisionSha256: readHash(paths.dispositionDecision),
      preparedAt: '2026-08-28T01:04:00.000Z',
    });
    fs.writeFileSync(paths.reviewBrief, `${JSON.stringify(brief, null, 2)}\n`);
    const outputPath = path.join(temp, 'bundle.json');
    const args = [
      'scripts/prepare-project-disposition-migration-review-bundle.mjs',
      '--review', paths.review,
      '--project-link-decision', paths.projectLinkDecision,
      '--project-disposition-decision', paths.dispositionDecision,
      '--review-brief', paths.reviewBrief,
      '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const bundle = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(bundle.format, 'ashbi-hub-project-disposition-review-import');
    assert.equal(bundle.reviewBrief.summary.approvalReady, 7);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
