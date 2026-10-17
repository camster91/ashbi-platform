import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EXPORT_ENTITIES, omitArgs, paginateEntity, exportWorkspace, verifyWorkspaceExportDirectory } from '../../services/workspace-export.service.js';

test('agent transcript export preserves archived history while scoping canonical active clients and excluding internal intent tokens', async () => {
  const conversations = EXPORT_ENTITIES.find(entity => entity.name === 'client_agent_conversations');
  const runs = EXPORT_ENTITIES.find(entity => entity.name === 'client_agent_runs');
  assert.deepEqual(conversations.where('org-a'), { organizationId: 'org-a', client: { organizationId: 'org-a', deletedAt: null } });
  assert.deepEqual(runs.where('org-a'), { organizationId: 'org-a', conversation: { organizationId: 'org-a', client: { organizationId: 'org-a', deletedAt: null } } });
  assert.deepEqual(omitArgs(runs), { idempotencyKey: true, inputHash: true, claimToken: true });
  const archivedAt = new Date('2026-10-15T00:00:00.000Z');
  const memorySnapshot = { version: 1, turns: [], truncated: false };
  const contextSnapshot = { version: 1, snapshot: { client: { id: 'client-a', name: 'Historical client', domain: null }, projects: [], truncated: false } };
  const expected = [{ id: 'run-a', prompt: 'Stored question', response: 'Stored answer', archivedAt,
    contextObservedAt: archivedAt, contextSnapshot, memorySnapshot }];
  const db = { clientAgentRun: { findMany: async args => {
    assert.deepEqual(args.where, runs.where('org-a'));
    assert.deepEqual(args.omit, omitArgs(runs));
    assert.equal(args.take, 500);
    return expected;
  } } };
  const actual = [];
  for await (const row of paginateEntity(db, runs, 'org-a')) actual.push(row);
  assert.deepEqual(actual, expected);
});


test('review export preserves exact run-keyed review state across pages within the exported transcript audience', async () => {
  const reviews = EXPORT_ENTITIES.find(entity => entity.name === 'client_agent_run_reviews');
  assert.ok(reviews, 'durable review state is exported, not silently discarded');
  assert.equal(reviews.model, 'ClientAgentRunReview');
  const scope = { organizationId: 'org-a', run: { organizationId: 'org-a', conversation: { organizationId: 'org-a', client: { organizationId: 'org-a', deletedAt: null } } } };
  assert.deepEqual(reviews.where('org-a'), scope);
  assert.equal(reviews.cursorField, 'runId');
  assert.equal(omitArgs(reviews), undefined, 'source run ID and review timestamp are preserved');
  const expected = Array.from({ length: 5 }, (_, index) => ({ runId: `run-${index}`, organizationId: 'org-a', reviewedAt: new Date(`2026-10-17T01:0${index}:00.000Z`) }));
  const calls = [];
  const db = { clientAgentRunReview: { findMany: async args => {
    calls.push(args);
    assert.deepEqual(args.orderBy, { runId: 'asc' }, 'review rows have no id column');
    const cursor = args.where.AND ? args.where.AND[1].runId.gt : null;
    assert.deepEqual(args.where, cursor ? { AND: [scope, { runId: { gt: cursor } }] } : scope);
    assert.equal(args.take, 2);
    assert.equal('id' in args.orderBy, false);
    return expected.filter(row => !cursor || row.runId > cursor).slice(0, args.take);
  } } };
  const actual = [];
  for await (const row of paginateEntity(db, reviews, 'org-a', 2)) actual.push(row);
  assert.deepEqual(actual, expected);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(1).map(call => call.where.AND[1].runId.gt), ['run-1', 'run-3']);
  assert.equal(new Set(actual.map(row => row.runId)).size, 5);
  // No archivedAt/requester predicate: owner export retains the same historical
  // shared and source-bound transcript audience as the existing run export.
  assert.doesNotMatch(JSON.stringify(scope), /archivedAt|requestedById|sourceChannelId|sourceBindingId/);
});


test('directory export writes review JSONL and verifies manifest/count/hash without inventing an id column', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ashbi-agent-review-export-'));
  try {
    const rows = Array.from({ length: 3 }, (_, index) => ({ runId: `run-${index}`, organizationId: 'org-a', reviewedAt: new Date(`2026-10-17T02:0${index}:00.000Z`) }));
    const db = { organization: { findUnique: async () => ({ id: 'org-a', name: 'Fixture', slug: 'fixture' }) } };
    for (const entity of EXPORT_ENTITIES) {
      const delegate = entity.model[0].toLowerCase() + entity.model.slice(1);
      db[delegate] = { findMany: async args => {
        if (entity.name !== 'client_agent_run_reviews') return [];
        assert.deepEqual(args.orderBy, { runId: 'asc' });
        const cursor = args.where.AND?.[1].runId.gt;
        assert.deepEqual(args.where, cursor ? { AND: [entity.where('org-a'), { runId: { gt: cursor } }] } : entity.where('org-a'));
        return rows.filter(row => !cursor || row.runId > cursor).slice(0, args.take);
      } };
    }
    db.organization.findUnique = async () => ({ id: 'org-a', name: 'Fixture', slug: 'fixture' });
    const outputDir = path.join(temp, 'export');
    const result = await exportWorkspace({ prisma: db, organizationId: 'org-a', outputDir, includeFiles: false, snapshot: false, pageSize: 2 });
    const entry = result.manifest.entities.find(entity => entity.name === 'client_agent_run_reviews');
    assert.equal(entry.rows, 3); assert.equal(entry.model, 'ClientAgentRunReview');
    const file = path.join(outputDir, entry.file);
    const saved = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(saved, JSON.parse(JSON.stringify(rows)));
    assert.ok(saved.every(row => !Object.hasOwn(row, 'id')));
    assert.equal((await verifyWorkspaceExportDirectory(outputDir, { expectedManifestSha256: result.manifestSha256 })).valid, true);
    await fs.appendFile(file, JSON.stringify(rows[0]) + '\n');
    const tampered = await verifyWorkspaceExportDirectory(outputDir, { expectedManifestSha256: result.manifestSha256 });
    assert.equal(tampered.valid, false); assert.ok(tampered.findings.some(finding => finding.code === 'DATA_CHECKSUM_MISMATCH'));
  } finally {
    assert.equal(path.dirname(temp), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temp).startsWith('ashbi-agent-review-export-'));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
