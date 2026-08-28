import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  exportTaskDispositionDecision,
  importTaskDispositionReviewPacket,
  recordMigrationReviewDecision,
  TASK_DISPOSITION_KIND,
} from '../../services/migrationReview.service.js';
import { prepareNotionBonsaiTaskLinkDecision } from '../../services/notionBonsaiTaskLinkDecision.service.js';
import {
  prepareNotionBonsaiTaskDispositionDecision,
  verifyNotionBonsaiTaskDispositionDecision,
} from '../../services/notionBonsaiTaskDispositionDecision.service.js';
import { prepareNotionBonsaiTaskDispositionReviewBrief } from '../../services/notionBonsaiTaskDispositionReviewBrief.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const LINK_HASH = 'b'.repeat(64);
const DISPOSITION_HASH = 'c'.repeat(64);

function review() {
  return {
    format: 'ashbi-notion-bonsai-task-review',
    version: 1,
    preparedAt: '2026-08-28T01:00:00.000Z',
    exactTaskLinks: [{
      notionSourceId: 'https://notion.so/shared', bonsaiSourceId: 'b-shared', taskTitle: 'Shared task',
      notionProject: 'Shared project', bonsaiProject: 'Shared project', projectTitleMatch: true, lifecycleMatch: true,
    }],
    nearTitleCandidates: [],
    notionOnly: [{ notionSourceId: 'https://notion.so/n1', title: 'Notion task', project: 'Notion project', status: 'Doing' }],
    bonsaiOnly: [],
    bonsaiSourceReview: [],
    sourceEvidence: { notionSnapshotSha256: 'd'.repeat(64), bonsaiSnapshotSha256: 'e'.repeat(64) },
  };
}

function input(requestId = '11111111-1111-4111-8111-111111111111', approveLink = true) {
  const source = review();
  const pendingLink = prepareNotionBonsaiTaskLinkDecision({
    review: source, reviewSha256: REVIEW_HASH, preparedAt: '2026-08-28T01:01:00.000Z',
  });
  const taskLinkDecision = approveLink ? prepareNotionBonsaiTaskLinkDecision({
    review: source,
    reviewSha256: REVIEW_HASH,
    preparedAt: '2026-08-28T01:02:00.000Z',
    decisions: [{ candidateId: pendingLink.candidates[0].candidateId, decision: 'APPROVED' }],
    approver: 'Cameron',
    decidedAt: '2026-08-28T01:01:30.000Z',
    reference: 'task-link-review',
  }) : pendingLink;
  const dispositionDecision = prepareNotionBonsaiTaskDispositionDecision({
    review: source,
    reviewSha256: REVIEW_HASH,
    taskLinkDecision,
    taskLinkDecisionSha256: LINK_HASH,
    preparedAt: '2026-08-28T01:03:00.000Z',
  });
  const reviewBrief = prepareNotionBonsaiTaskDispositionReviewBrief({
    review: source,
    reviewSha256: REVIEW_HASH,
    taskLinkDecision,
    taskLinkDecisionSha256: LINK_HASH,
    decision: dispositionDecision,
    decisionSha256: DISPOSITION_HASH,
    preparedAt: '2026-08-28T01:04:00.000Z',
  });
  return {
    format: 'ashbi-hub-task-disposition-review-import',
    version: 1,
    requestId,
    review: source,
    reviewSha256: REVIEW_HASH,
    taskLinkDecision,
    taskLinkDecisionSha256: LINK_HASH,
    mappingDecision: null,
    mappingDecisionSha256: null,
    dispositionDecision,
    dispositionDecisionSha256: DISPOSITION_HASH,
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
      async findMany() {
        return packets.map(packet => ({ ...packet, decisions: decisions.filter(item => item.packetId === packet.id) }));
      },
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

test('imports task-disposition evidence replay-safely and exports approved recommendations without applying them', async () => {
  const prismaClient = fakePrisma();
  const evidence = input();
  const first = await importTaskDispositionReviewPacket({
    prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:05:00.000Z'),
  });
  const replay = await importTaskDispositionReviewPacket({
    prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:06:00.000Z'),
  });
  assert.equal(first.packet.kind, TASK_DISPOSITION_KIND);
  assert.equal(first.packet.summary.total, 3);
  assert.equal(replay.replayed, true);
  assert.equal(prismaClient.packets.length, 1);

  const candidate = first.packet.candidates.find(item => item.recommendedDisposition === 'MIGRATE_TO_HUB');
  await recordMigrationReviewDecision({
    prismaClient,
    packetId: first.packet.id,
    candidateId: candidate.candidateId,
    requestId: '22222222-2222-4222-8222-222222222222',
    decision: 'APPROVED',
    reviewNote: 'Keep the Notion source ID.',
    reviewedBy: 'cameron@ashbi.ca',
    now: new Date('2026-08-28T01:07:00.000Z'),
  });
  const record = await exportTaskDispositionDecision({
    prismaClient, packetId: first.packet.id, now: new Date('2026-08-28T01:08:00.000Z'),
  });
  const verified = verifyNotionBonsaiTaskDispositionDecision({
    review: evidence.review,
    reviewSha256: REVIEW_HASH,
    taskLinkDecision: evidence.taskLinkDecision,
    taskLinkDecisionSha256: LINK_HASH,
    record,
  });
  assert.equal(verified.valid, true);
  assert.equal(verified.decided, 1);
  assert.equal(record.safeguards.dispositionsApplied, false);
  assert.equal(record.safeguards.migrationOrCutoverAuthorized, false);
});

test('does not allow a blocked task recommendation to be approved', async () => {
  const prismaClient = fakePrisma();
  const evidence = input('33333333-3333-4333-8333-333333333333', false);
  const imported = await importTaskDispositionReviewPacket({ prismaClient, input: evidence, importedBy: 'cameron@ashbi.ca' });
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

test('task-disposition bundle CLI verifies exact files and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-disposition-hub-review-'));
  try {
    const evidence = input();
    const paths = Object.fromEntries(['review', 'taskLinkDecision', 'dispositionDecision', 'reviewBrief']
      .map(key => [key, path.join(temp, `${key}.json`)]));
    const values = {
      review: evidence.review,
      taskLinkDecision: null,
      dispositionDecision: null,
      reviewBrief: null,
    };
    fs.writeFileSync(paths.review, `${JSON.stringify(values.review, null, 2)}\n`);
    const readHash = filePath => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const pendingLink = prepareNotionBonsaiTaskLinkDecision({
      review: values.review,
      reviewSha256: readHash(paths.review),
      preparedAt: '2026-08-28T01:01:00.000Z',
    });
    values.taskLinkDecision = prepareNotionBonsaiTaskLinkDecision({
      review: values.review,
      reviewSha256: readHash(paths.review),
      preparedAt: '2026-08-28T01:02:00.000Z',
      decisions: [{ candidateId: pendingLink.candidates[0].candidateId, decision: 'APPROVED' }],
      approver: 'Cameron',
      decidedAt: '2026-08-28T01:01:30.000Z',
      reference: 'task-link-review',
    });
    fs.writeFileSync(paths.taskLinkDecision, `${JSON.stringify(values.taskLinkDecision, null, 2)}\n`);
    values.dispositionDecision = prepareNotionBonsaiTaskDispositionDecision({
      review: values.review,
      reviewSha256: readHash(paths.review),
      taskLinkDecision: values.taskLinkDecision,
      taskLinkDecisionSha256: readHash(paths.taskLinkDecision),
      preparedAt: '2026-08-28T01:03:00.000Z',
    });
    fs.writeFileSync(paths.dispositionDecision, `${JSON.stringify(values.dispositionDecision, null, 2)}\n`);
    values.reviewBrief = prepareNotionBonsaiTaskDispositionReviewBrief({
      review: values.review,
      reviewSha256: readHash(paths.review),
      taskLinkDecision: values.taskLinkDecision,
      taskLinkDecisionSha256: readHash(paths.taskLinkDecision),
      decision: values.dispositionDecision,
      decisionSha256: readHash(paths.dispositionDecision),
      preparedAt: '2026-08-28T01:04:00.000Z',
    });
    fs.writeFileSync(paths.reviewBrief, `${JSON.stringify(values.reviewBrief, null, 2)}\n`);
    const outputPath = path.join(temp, 'bundle.json');
    const args = [
      'scripts/prepare-task-disposition-migration-review-bundle.mjs',
      '--review', paths.review,
      '--task-link-decision', paths.taskLinkDecision,
      '--task-disposition-decision', paths.dispositionDecision,
      '--review-brief', paths.reviewBrief,
      '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const bundle = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(bundle.format, 'ashbi-hub-task-disposition-review-import');
    assert.equal(bundle.reviewBrief.summary.approvalReady, 3);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
