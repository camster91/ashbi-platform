import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  exportProjectLinkDecision,
  importProjectLinkReviewPacket,
  recordMigrationReviewDecision,
} from '../../services/migrationReview.service.js';
import { prepareNotionBonsaiNativeProjectLinkReviewBrief } from '../../services/notionBonsaiNativeProjectLinkReviewBrief.service.js';
import { verifyNotionBonsaiNativeProjectLinkDecision } from '../../services/notionBonsaiNativeProjectLinkDecision.service.js';

const REVIEW_HASH = 'a'.repeat(64);
const MAPPING_HASH = 'b'.repeat(64);
const TASK_HASH = 'c'.repeat(64);

function sourceReview() {
  return {
    format: 'ashbi-notion-bonsai-native-project-review',
    version: 1,
    preparedAt: '2026-08-28T01:00:00.000Z',
    exactProjectLinks: [{
      notionSourceId: 'https://notion.so/project-a', notionProject: 'Project A', notionStatus: 'Active',
      bonsaiProjectId: '101', bonsaiProject: 'Project A', bonsaiStatus: 'active',
      evidence: 'EXACT_UNIQUE_PROJECT_TITLE', lifecycleMatch: true,
    }],
    taskEvidencedProjectCandidates: [],
    possibleTitlePairs: [],
    sourceEvidence: {
      notionSnapshotSha256: 'd'.repeat(64),
      bonsaiProjectSnapshotSha256: 'e'.repeat(64),
      taskReviewSha256: TASK_HASH,
    },
  };
}

function mappingDecision() {
  return {
    format: 'ashbi-notion-bonsai-mapping-decision',
    version: 2,
    preparedAt: '2026-08-28T01:01:00.000Z',
    candidates: [],
    sourceEvidence: { reviewSha256: TASK_HASH },
  };
}

function importInput(requestId = '11111111-1111-4111-8111-111111111111') {
  const review = sourceReview();
  const mapping = mappingDecision();
  return {
    requestId,
    review,
    reviewSha256: REVIEW_HASH,
    mappingDecision: mapping,
    mappingDecisionSha256: MAPPING_HASH,
    reviewBrief: prepareNotionBonsaiNativeProjectLinkReviewBrief({
      review,
      reviewSha256: REVIEW_HASH,
      mappingDecision: mapping,
      mappingDecisionSha256: MAPPING_HASH,
      preparedAt: '2026-08-28T01:02:00.000Z',
    }),
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
        return packets.map(packet => ({ ...packet, decisions: decisions.filter(item => item.packetId === packet.id).sort((a, b) => b.decidedAt - a.decidedAt) }));
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

test('imports verified evidence exactly once without applying a source link', async () => {
  const prismaClient = fakePrisma();
  const input = importInput();
  const first = await importProjectLinkReviewPacket({
    prismaClient, input, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:03:00.000Z'),
  });
  const replay = await importProjectLinkReviewPacket({
    prismaClient, input, importedBy: 'cameron@ashbi.ca', now: new Date('2026-08-28T01:04:00.000Z'),
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(prismaClient.packets.length, 1);
  assert.deepEqual(first.packet.summary, { total: 1, approved: 0, rejected: 0, pending: 1 });
  assert.equal(first.packet.safeguards.externalWritesPerformed, false);
  assert.equal(first.packet.safeguards.projectLinksApplied, false);
});

test('refuses changed evidence under an existing request ID', async () => {
  const prismaClient = fakePrisma();
  const input = importInput();
  await importProjectLinkReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  const changed = importInput();
  changed.review.exactProjectLinks[0].bonsaiProject = 'Changed project';
  changed.reviewBrief = prepareNotionBonsaiNativeProjectLinkReviewBrief({
    review: changed.review,
    reviewSha256: changed.reviewSha256,
    mappingDecision: changed.mappingDecision,
    mappingDecisionSha256: changed.mappingDecisionSha256,
    preparedAt: '2026-08-28T01:02:00.000Z',
  });
  await assert.rejects(
    importProjectLinkReviewPacket({ prismaClient, input: changed, importedBy: 'cameron@ashbi.ca' }),
    /different evidence/,
  );
});

test('records immutable replay-safe candidate decisions and exports a valid bounded record', async () => {
  const prismaClient = fakePrisma();
  const input = importInput();
  const imported = await importProjectLinkReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  const candidateId = imported.packet.candidates[0].candidateId;
  const action = {
    prismaClient,
    packetId: imported.packet.id,
    candidateId,
    requestId: '22222222-2222-4222-8222-222222222222',
    decision: 'APPROVED',
    reviewedBy: 'cameron@ashbi.ca',
    now: new Date('2026-08-28T01:05:00.000Z'),
  };
  const first = await recordMigrationReviewDecision(action);
  const replay = await recordMigrationReviewDecision(action);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(prismaClient.decisions.length, 1);
  assert.deepEqual(first.packet.summary, { total: 1, approved: 1, rejected: 0, pending: 0 });

  const record = await exportProjectLinkDecision({
    prismaClient,
    packetId: imported.packet.id,
    now: new Date('2026-08-28T01:06:00.000Z'),
  });
  const verified = verifyNotionBonsaiNativeProjectLinkDecision({ review: input.review, reviewSha256: REVIEW_HASH, record });
  assert.equal(verified.valid, true);
  assert.equal(verified.approved, 1);
  assert.equal(record.safeguards.projectLinksApplied, false);
  assert.equal(record.safeguards.migrationOrCutoverAuthorized, false);
});

test('recovers the winning decision after a concurrent unique-key race', async () => {
  const prismaClient = fakePrisma();
  const input = importInput();
  const imported = await importProjectLinkReviewPacket({ prismaClient, input, importedBy: 'cameron@ashbi.ca' });
  const candidateId = imported.packet.candidates[0].candidateId;
  const requestId = '33333333-3333-4333-8333-333333333333';
  const winner = {
    id: 'winner', packetId: imported.packet.id, candidateId, requestId,
    decision: 'APPROVED', reviewNote: null, reviewedBy: 'cameron@ashbi.ca',
    decidedAt: new Date('2026-08-28T01:05:00.000Z'), createdAt: new Date('2026-08-28T01:05:00.000Z'),
  };
  prismaClient.migrationReviewDecision.create = async () => {
    prismaClient.decisions.push(winner);
    const error = new Error('unique');
    error.code = 'P2002';
    throw error;
  };
  const result = await recordMigrationReviewDecision({
    prismaClient,
    packetId: imported.packet.id,
    candidateId,
    requestId,
    decision: 'APPROVED',
    reviewedBy: 'cameron@ashbi.ca',
  });
  assert.equal(result.replayed, true);
  assert.equal(result.decision.id, 'winner');
  assert.equal(result.packet.summary.approved, 1);
});

test('route and UI keep migration review admin-only, tenant-scoped, and separate from application', () => {
  const route = fs.readFileSync(new URL('../../routes/migration-review.routes.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../../../web/src/App.jsx', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../../../web/src/pages/MigrationReviews.jsx', import.meta.url), 'utf8');
  const proxy = fs.readFileSync(new URL('../../utils/prisma-tenant-proxy.js', import.meta.url), 'utf8');
  assert.match(route, /fastify\.authenticate, fastify\.adminOnly/);
  assert.match(route, /prismaClient: request\.prisma/);
  assert.match(route, /task-dispositions\/import/);
  assert.match(route, /project-dispositions\/import/);
  assert.match(route, /financial-exceptions\/import/);
  assert.match(route, /active-project-outcomes\/import/);
  assert.doesNotMatch(route, /config\/db|fetch\(|axios|Bonsai/i);
  assert.match(proxy, /migrationreviewpacket/);
  assert.match(proxy, /migrationreviewdecision/);
  assert.match(app, /AdminRoute><MigrationReviews/);
  assert.match(page, /do not edit Notion, Bonsai/);
  assert.match(page, /ashbi-hub-task-disposition-review-import/);
  assert.match(page, /ashbi-hub-project-disposition-review-import/);
  assert.match(page, /ashbi-hub-financial-exception-review-import/);
  assert.match(page, /ashbi-hub-active-project-outcome-review-import/);
  assert.match(page, /Superseded generation/);
  assert.match(page, /Select low\/medium approval-ready/);
  assert.match(page, /Approve selected/);
  assert.match(page, /<ConfirmDialog/);
  assert.match(page, /recordMigrationReviewDecision/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.doesNotMatch(page, /Apply to Bonsai|Delete from Notion/);
});

test('packet identity permits new evidence generations and the database accepts every review kind', () => {
  const schema = fs.readFileSync(new URL('../../../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = fs.readFileSync(new URL('../../../prisma/migrations/20260828113000_migration_review_packet_generations/migration.sql', import.meta.url), 'utf8');
  const financialMigration = fs.readFileSync(new URL('../../../prisma/migrations/20260828120000_financial_exception_review_kind/migration.sql', import.meta.url), 'utf8');
  const activeProjectMigration = fs.readFileSync(new URL('../../../prisma/migrations/20260828123000_active_project_outcome_review_kind/migration.sql', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../../services/migrationReview.service.js', import.meta.url), 'utf8');
  assert.match(schema, /evidenceFingerprint\s+String/);
  assert.match(schema, /@@unique\(\[organizationId, kind, evidenceFingerprint\]\)/);
  assert.doesNotMatch(schema, /@@unique\(\[organizationId, kind, sourceReviewSha256\]\)/);
  assert.match(migration, /DROP INDEX "migration_review_packets_organizationId_kind_sourceReviewSha256_key"/);
  assert.match(migration, /NOTION_BONSAI_TASK_DISPOSITION/);
  assert.match(migration, /NOTION_BONSAI_PROJECT_DISPOSITION/);
  assert.match(financialMigration, /BONSAI_FINANCIAL_EXCEPTION/);
  assert.match(activeProjectMigration, /BONSAI_ACTIVE_PROJECT_OUTCOME/);
  assert.match(service, /where: \{ kind: PROJECT_DISPOSITION_KIND, evidenceFingerprint: fingerprint \}/);
});

test('bundle CLI verifies the exact source files and refuses overwrite', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-migration-review-'));
  try {
    const reviewPath = path.join(temp, 'review.json');
    const mappingPath = path.join(temp, 'mapping.json');
    const briefPath = path.join(temp, 'brief.json');
    const outputPath = path.join(temp, 'bundle.json');
    const reviewBytes = Buffer.from(`${JSON.stringify(sourceReview(), null, 2)}\n`);
    const mappingBytes = Buffer.from(`${JSON.stringify(mappingDecision(), null, 2)}\n`);
    fs.writeFileSync(reviewPath, reviewBytes);
    fs.writeFileSync(mappingPath, mappingBytes);
    const reviewSha256 = crypto.createHash('sha256').update(reviewBytes).digest('hex');
    const mappingDecisionSha256 = crypto.createHash('sha256').update(mappingBytes).digest('hex');
    const reviewBrief = prepareNotionBonsaiNativeProjectLinkReviewBrief({
      review: sourceReview(),
      reviewSha256,
      mappingDecision: mappingDecision(),
      mappingDecisionSha256,
      preparedAt: '2026-08-28T01:02:00.000Z',
    });
    fs.writeFileSync(briefPath, `${JSON.stringify(reviewBrief, null, 2)}\n`);
    const args = [
      'scripts/prepare-migration-review-bundle.mjs',
      '--review', reviewPath,
      '--mapping-decision', mappingPath,
      '--review-brief', briefPath,
      '--output', outputPath,
    ];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    const bundle = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(bundle.reviewSha256, reviewSha256);
    assert.equal(bundle.reviewBrief.summary.approvalReady, 1);
    assert.match(bundle.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
